import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { RedisService } from '@infrastructure/redis/redis.service';

import { WsJwtService } from './ws-jwt.service';
import { ConversationsService } from '../messaging/conversations.service';

import type Redis from 'ioredis';

// Redis pub/sub channels and the corresponding socket rooms.
// Driver location: keyed by deliveryId (only set when a Delivery row
// exists, i.e. delivery-fulfillment orders that have moved past
// READY). Order status: keyed by orderId, fires for every order
// (pickup + delivery), so the buyer can subscribe right after
// `POST /v1/orders` and watch the stepper advance.
const LOC_PATTERN = 'delivery:*:loc';
const LOC_PREFIX = 'delivery:';
const LOC_SUFFIX = ':loc';

const STATUS_PATTERN = 'order:*:status';
const STATUS_PREFIX = 'order:';
const STATUS_SUFFIX = ':status';

// Persisted-conversation chat: keyed by the DB `Conversation.id`.
// Same channel handles every conversation type (BUYER_SELLER,
// BUYER_DELIVERY, SUPPORT) — the client tells us which to subscribe
// to via `conv:subscribe { conversationId }` and the server verifies
// membership against ConversationParticipant before joining the room.
const CONV_PATTERN = 'conv:*:msg';
const CONV_PREFIX = 'conv:';
const CONV_SUFFIX = ':msg';

// Per-user delivery events (e.g. a cancelled/failed assigned delivery). Keyed
// by the recipient User.id and fanned out to their `user:<id>` room — the
// socket auto-joins this room on connect, so no explicit subscribe is needed.
const USER_PATTERN = 'user:*:delivery';
const USER_PREFIX = 'user:';
const USER_SUFFIX = ':delivery';

export const driverLocChannel = (deliveryId: string): string =>
  `${LOC_PREFIX}${deliveryId}${LOC_SUFFIX}`;
export const orderStatusChannel = (orderId: string): string =>
  `${STATUS_PREFIX}${orderId}${STATUS_SUFFIX}`;
export const conversationChannel = (conversationId: string): string =>
  `${CONV_PREFIX}${conversationId}${CONV_SUFFIX}`;
export const userDeliveryChannel = (userId: string): string =>
  `${USER_PREFIX}${userId}${USER_SUFFIX}`;

interface SocketData {
  user?: AuthenticatedUser;
  internalUserId?: string;
}

/**
 * Realtime fanout for driver positions. Buyers subscribe to a delivery's
 * room over WebSocket; the deliveries controller publishes to Redis on
 * every driver POST /v1/drivers/me/location, and this gateway re-emits
 * to socket rooms via Redis pub/sub (works across replicas).
 */
@WebSocketGateway({
  namespace: '/tracking',
  cors: { origin: true, credentials: true },
})
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(TrackingGateway.name);
  private subscriber!: Redis;

  constructor(
    private readonly ws: WsJwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly conversations: ConversationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.client.duplicate();
    // duplicate() returns a not-yet-connected client when the source is
    // lazyConnect; .connect() is idempotent in ioredis if already open.
    if (this.subscriber.status === 'wait' || this.subscriber.status === 'end') {
      await this.subscriber.connect();
    }
    await this.subscriber.psubscribe(LOC_PATTERN);
    await this.subscriber.psubscribe(STATUS_PATTERN);
    await this.subscriber.psubscribe(CONV_PATTERN);
    await this.subscriber.psubscribe(USER_PATTERN);
    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      try {
        if (channel.startsWith(LOC_PREFIX) && channel.endsWith(LOC_SUFFIX)) {
          const deliveryId = channel.slice(LOC_PREFIX.length, channel.length - LOC_SUFFIX.length);
          this.server.to(`delivery:${deliveryId}`).emit('driver:location', JSON.parse(message));
        } else if (channel.startsWith(STATUS_PREFIX) && channel.endsWith(STATUS_SUFFIX)) {
          const orderId = channel.slice(
            STATUS_PREFIX.length,
            channel.length - STATUS_SUFFIX.length,
          );
          this.server.to(`order:${orderId}`).emit('order:status', JSON.parse(message));
        } else if (channel.startsWith(USER_PREFIX) && channel.endsWith(USER_SUFFIX)) {
          const userId = channel.slice(USER_PREFIX.length, channel.length - USER_SUFFIX.length);
          this.server.to(`user:${userId}`).emit('delivery:cancelled', JSON.parse(message));
        } else if (channel.startsWith(CONV_PREFIX) && channel.endsWith(CONV_SUFFIX)) {
          const conversationId = channel.slice(
            CONV_PREFIX.length,
            channel.length - CONV_SUFFIX.length,
          );
          this.server.to(`conv:${conversationId}`).emit('message:new', JSON.parse(message));
        }
      } catch (err) {
        this.logger.warn(`bad pubsub payload on ${channel}: ${(err as Error).message}`);
      }
    });
    this.logger.log(
      `TrackingGateway subscribed to Redis patterns ${LOC_PATTERN}, ${STATUS_PATTERN}, ${CONV_PATTERN}, ${USER_PATTERN}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.subscriber?.punsubscribe(LOC_PATTERN);
      await this.subscriber?.punsubscribe(STATUS_PATTERN);
      await this.subscriber?.punsubscribe(CONV_PATTERN);
      await this.subscriber?.punsubscribe(USER_PATTERN);
      await this.subscriber?.quit();
    } catch {
      /* shutdown best-effort */
    }
  }

  async handleConnection(@ConnectedSocket() socket: Socket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) {
      this.logger.warn(`socket ${socket.id} rejected: missing token`);
      socket.emit('error', { message: 'unauthorized: missing token' });
      socket.disconnect(true);
      return;
    }
    try {
      const user = await this.ws.verify(token);
      (socket.data as SocketData).user = user;
      // Join the per-user room so targeted events (e.g. delivery:cancelled for
      // the assigned driver) reach this socket without an explicit subscribe.
      const internal = await this.prisma.db.user.findUnique({
        where: { supabaseId: user.id },
        select: { id: true },
      });
      if (internal) {
        (socket.data as SocketData).internalUserId = internal.id;
        await socket.join(`user:${internal.id}`);
      }
      this.logger.debug(`socket ${socket.id} connected (user=${user.id})`);
    } catch (err) {
      this.logger.warn(`socket ${socket.id} auth failed: ${(err as Error).message}`);
      socket.emit('error', { message: 'unauthorized' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(@ConnectedSocket() socket: Socket): void {
    this.logger.debug(`socket ${socket.id} disconnected`);
  }

  /**
   * Client emits: `subscribe`, `{ orderId }` (preferred) or
   * `{ deliveryId }`. Server resolves to the underlying Order, checks
   * the caller is its buyer, and joins:
   *   - `order:<orderId>`   — always (status events; works for pickup
   *                            orders that have no delivery row yet)
   *   - `delivery:<deliveryId>` — only when a Delivery row exists
   *                                (driver location events)
   * Acks with `{ ok, orderId, deliveryId|null }`.
   */
  @SubscribeMessage('subscribe')
  async onSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { orderId?: string; deliveryId?: string } | undefined,
  ): Promise<{ ok: true; orderId: string; deliveryId: string | null }> {
    const data = socket.data as SocketData;
    const user = data.user;
    if (!user) throw new WsException('unauthorized');

    const orderIdIn = typeof body?.orderId === 'string' ? body.orderId : undefined;
    const deliveryIdIn = typeof body?.deliveryId === 'string' ? body.deliveryId : undefined;
    if (!orderIdIn && !deliveryIdIn) {
      throw new WsException('orderId or deliveryId required');
    }

    if (!data.internalUserId) {
      const internal = await this.prisma.db.user.findUnique({
        where: { supabaseId: user.id },
        select: { id: true },
      });
      if (!internal) throw new WsException('user not found');
      data.internalUserId = internal.id;
    }

    // Resolve to the canonical order. Either: caller gave deliveryId →
    // load delivery → orderId via FK; or caller gave orderId → use it.
    let resolvedOrderId: string;
    let resolvedDeliveryId: string | null;
    let buyerId: string;
    if (deliveryIdIn) {
      const delivery = await this.prisma.db.delivery.findUnique({
        where: { id: deliveryIdIn },
        select: { id: true, orderId: true, order: { select: { buyerId: true } } },
      });
      if (!delivery) throw new WsException('delivery not found');
      resolvedDeliveryId = delivery.id;
      resolvedOrderId = delivery.orderId;
      buyerId = delivery.order.buyerId;
    } else {
      const order = await this.prisma.db.order.findUnique({
        where: { id: orderIdIn },
        select: { id: true, buyerId: true },
      });
      if (!order) throw new WsException('order not found');
      const delivery = await this.prisma.db.delivery.findFirst({
        where: { orderId: order.id },
        select: { id: true },
      });
      resolvedOrderId = order.id;
      resolvedDeliveryId = delivery?.id ?? null;
      buyerId = order.buyerId;
    }
    if (buyerId !== data.internalUserId) {
      throw new WsException('forbidden');
    }

    await socket.join(`order:${resolvedOrderId}`);
    if (resolvedDeliveryId) {
      await socket.join(`delivery:${resolvedDeliveryId}`);
    }
    return { ok: true, orderId: resolvedOrderId, deliveryId: resolvedDeliveryId };
  }

  @SubscribeMessage('unsubscribe')
  async onUnsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { deliveryId?: string } | undefined,
  ): Promise<{ ok: true }> {
    const deliveryId = body?.deliveryId;
    if (deliveryId) await socket.leave(`delivery:${deliveryId}`);
    return { ok: true };
  }

  /**
   * Conversation subscribe. The client passes the DB conversation id
   * (returned by `POST /v1/conversations`); the server verifies the
   * caller is a participant via ConversationsService.assertParticipant
   * and joins them to `conv:<id>`. Same `message:new` event payload
   * shape as before — see `PersistedMessage` in messaging.service.ts.
   */
  @SubscribeMessage('conv:subscribe')
  async onConvSubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { conversationId?: string } | undefined,
  ): Promise<{ ok: true; conversationId: string }> {
    const data = socket.data as SocketData;
    const user = data.user;
    if (!user) throw new WsException('unauthorized');
    const conversationId =
      typeof body?.conversationId === 'string' ? body.conversationId : undefined;
    if (!conversationId) throw new WsException('conversationId required');

    try {
      // assertParticipant doubles as a 404 + 403 + auth check.
      await this.conversations.assertParticipant(user.id, conversationId);
    } catch (err) {
      throw new WsException((err as Error).message);
    }
    await socket.join(`conv:${conversationId}`);
    return { ok: true, conversationId };
  }

  @SubscribeMessage('conv:unsubscribe')
  async onConvUnsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { conversationId?: string } | undefined,
  ): Promise<{ ok: true }> {
    if (body?.conversationId) await socket.leave(`conv:${body.conversationId}`);
    return { ok: true };
  }

  private extractToken(socket: Socket): string | undefined {
    const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const header = socket.handshake.headers['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return undefined;
  }
}
