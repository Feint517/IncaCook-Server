import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConversationType, ParticipantRole } from '@prisma/client';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { FindOrCreateConversationDto } from './dto/find-or-create-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations.query.dto';

export interface ConversationListItem {
  id: string;
  type: ConversationType;
  orderId: string | null;
  storeId: string | null;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  myRole: ParticipantRole;
  peer: {
    userId: string;
    displayName: string;
    avatarPath: string | null;
    role: ParticipantRole;
  };
}

/**
 * Owns Conversation lifecycle: find-or-create with per-type
 * uniqueness, role-filtered listing, mark-as-read, message history.
 * Sending lives in MessagingService (which also handles the realtime
 * fanout) so persistence + broadcast stay coupled.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the caller's role for a given peer + type. Sellers and
   * delivery partners are identified by having a SellerProfile /
   * DriverProfile respectively. BUYER is the default.
   */
  private async resolveRole(
    userId: string,
    type: ConversationType,
    isCaller: boolean,
  ): Promise<ParticipantRole> {
    if (type === ConversationType.SUPPORT) {
      // Caller is always the user; SUPPORT staff are seeded later
      // (Phase B). For now, the non-caller of a SUPPORT thread is
      // tagged SUPPORT and the caller stays BUYER.
      return isCaller ? ParticipantRole.BUYER : ParticipantRole.SUPPORT;
    }
    const profile = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: {
        sellerProfile: { select: { userId: true } },
        driverProfile: { select: { userId: true } },
      },
    });
    if (type === ConversationType.BUYER_DELIVERY) {
      // Delivery thread is buyer ↔ driver. Identify by DriverProfile.
      return profile?.driverProfile != null ? ParticipantRole.DELIVERY : ParticipantRole.BUYER;
    }
    if (type === ConversationType.SELLER_DRIVER) {
      // Seller ↔ driver thread: the driver has a DriverProfile, the other
      // party is the seller.
      return profile?.driverProfile != null ? ParticipantRole.DELIVERY : ParticipantRole.SELLER;
    }
    // BUYER_SELLER: the one with a SellerProfile is the seller.
    return profile?.sellerProfile != null ? ParticipantRole.SELLER : ParticipantRole.BUYER;
  }

  /**
   * Derive the conversation counterpart from an order when the caller
   * didn't supply `peerUserId`. The caller must be a party to the order
   * (buyer, seller, or its assigned driver); the peer is the "other
   * side" for the requested type. Powers the buyer↔livreur chat, where
   * neither party knows the other's user id — only the shared order.
   */
  private async resolvePeerFromOrder(
    callerId: string,
    type: ConversationType,
    orderId: string | undefined,
  ): Promise<string> {
    if (type === ConversationType.SUPPORT) {
      throw new BadRequestException('SUPPORT conversations require an explicit peerUserId');
    }
    if (!orderId) {
      throw new BadRequestException('peerUserId or orderId is required');
    }

    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: {
        buyerId: true,
        sellerId: true,
        // Latest delivery row — a failed delivery may be superseded by a
        // reassigned one, so the most recent carries the live driver.
        deliveries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { driverId: true },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const driverId = order.deliveries[0]?.driverId ?? null;
    const isBuyer = callerId === order.buyerId;
    const isSeller = callerId === order.sellerId;
    const isDriver = driverId != null && callerId === driverId;
    if (!isBuyer && !isSeller && !isDriver) {
      throw new ForbiddenException('You are not a party to this order');
    }

    if (type === ConversationType.BUYER_DELIVERY) {
      if (isBuyer) {
        if (!driverId) {
          throw new BadRequestException('No driver has been assigned to this order yet');
        }
        return driverId;
      }
      if (isDriver) return order.buyerId;
      throw new BadRequestException(
        'Only the buyer or the assigned driver can open a delivery chat',
      );
    }

    if (type === ConversationType.SELLER_DRIVER) {
      // Seller ↔ assigned driver. The buyer is never a party here.
      if (isSeller) {
        if (!driverId) {
          throw new BadRequestException('No driver has been assigned to this order yet');
        }
        return driverId;
      }
      if (isDriver) return order.sellerId;
      throw new BadRequestException('Only the seller or the assigned driver can open this chat');
    }

    // BUYER_SELLER
    if (isBuyer) return order.sellerId;
    if (isSeller) return order.buyerId;
    throw new BadRequestException('Only the buyer or seller can open this chat');
  }

  /**
   * Idempotent — returns the existing conversation when one matches
   * the (type, orderId, participant pair) tuple; creates one otherwise.
   * Both participants are inserted in a single transaction so the
   * lookup invariant ("a conversation always has both parties") holds.
   */
  async findOrCreate(
    supabaseId: string,
    dto: FindOrCreateConversationDto,
  ): Promise<{ id: string; type: ConversationType }> {
    const caller = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!caller) throw new NotFoundException('User profile not found');

    // BUYER_DELIVERY (buyer ↔ driver) can be opened either order-scoped
    // (orderId — the peer is derived from the order's assigned driver) or
    // directly by peerUserId. Require at least one so the peer is resolvable.
    if (
      (dto.type === ConversationType.BUYER_DELIVERY ||
        dto.type === ConversationType.SELLER_DRIVER) &&
      !dto.orderId &&
      !dto.peerUserId
    ) {
      throw new BadRequestException(`${dto.type} requires an orderId or peerUserId`);
    }

    // Resolve the counterpart. The caller may name it explicitly
    // (peerUserId) or leave it to the server to derive from the order
    // — the buyer↔livreur path uses the latter, since neither side
    // knows the other's user id.
    const peerUserId =
      dto.peerUserId ?? (await this.resolvePeerFromOrder(caller.id, dto.type, dto.orderId));

    if (caller.id === peerUserId) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }
    const peer = await this.prisma.db.user.findUnique({
      where: { id: peerUserId },
      select: { id: true },
    });
    if (!peer) throw new NotFoundException('Peer user not found');

    // Existing conversation: same type + same orderId scope + both
    // participants present. Sorting both sides into a Set means the
    // uniqueness check doesn't care about who initiated.
    const existing = await this.prisma.db.conversation.findFirst({
      where: {
        type: dto.type,
        orderId: dto.orderId ?? null,
        participants: {
          every: { userId: { in: [caller.id, peerUserId] } },
        },
        // Anti-cross-pair guard: also enforce both ids appear at least
        // once (the `every` clause above lets through threads with
        // only one participant in the pair).
        AND: [
          { participants: { some: { userId: caller.id } } },
          { participants: { some: { userId: peerUserId } } },
        ],
      },
      select: { id: true, type: true },
    });
    if (existing) return existing;

    const callerRole = await this.resolveRole(caller.id, dto.type, true);
    const peerRole = await this.resolveRole(peerUserId, dto.type, false);
    const conversationId = generateUlid();

    await this.prisma.$transaction(async (tx) => {
      await tx.conversation.create({
        data: {
          id: conversationId,
          type: dto.type,
          orderId: dto.orderId ?? null,
          storeId: dto.storeId ?? null,
        },
      });
      await tx.conversationParticipant.createMany({
        data: [
          {
            id: generateUlid(),
            conversationId,
            userId: caller.id,
            role: callerRole,
          },
          {
            id: generateUlid(),
            conversationId,
            userId: peerUserId,
            role: peerRole,
          },
        ],
      });
    });

    return { id: conversationId, type: dto.type };
  }

  /**
   * Creates (or reuses) the seller ↔ driver conversation for an order. Called
   * automatically when a driver claims the delivery, so the two coordinate
   * pickup. Idempotent: re-claiming / re-calling returns the existing thread
   * (deduped on type + orderId + both participants). System-initiated, so it
   * takes ids directly rather than a JWT. Never throws — chat must never block
   * the claim. Returns whether a new conversation was created.
   */
  async ensureSellerDriverConversation(
    orderId: string,
    driverId: string,
    deliveryId?: string,
  ): Promise<{ id: string | null; created: boolean }> {
    try {
      const order = await this.prisma.db.order.findUnique({
        where: { id: orderId },
        select: { sellerId: true },
      });
      if (!order || order.sellerId === driverId) {
        return { id: null, created: false };
      }
      const sellerId = order.sellerId;

      const existing = await this.prisma.db.conversation.findFirst({
        where: {
          type: ConversationType.SELLER_DRIVER,
          orderId,
          AND: [
            { participants: { some: { userId: sellerId } } },
            { participants: { some: { userId: driverId } } },
          ],
        },
        select: { id: true },
      });
      if (existing) {
        this.logger.log(`[SellerDriverChat] existing conversation=${existing.id} order=${orderId}`);
        return { id: existing.id, created: false };
      }

      const conversationId = generateUlid();
      this.logger.log(
        `[SellerDriverChat] creating conversation order=${orderId} delivery=${deliveryId ?? '-'}`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.conversation.create({
          data: { id: conversationId, type: ConversationType.SELLER_DRIVER, orderId },
        });
        await tx.conversationParticipant.createMany({
          data: [
            { id: generateUlid(), conversationId, userId: sellerId, role: ParticipantRole.SELLER },
            {
              id: generateUlid(),
              conversationId,
              userId: driverId,
              role: ParticipantRole.DELIVERY,
            },
          ],
        });
      });
      return { id: conversationId, created: true };
    } catch (err) {
      this.logger.warn(
        `[SellerDriverChat] ensure failed for order=${orderId}: ${(err as Error).message}`,
      );
      return { id: null, created: false };
    }
  }

  /**
   * Conversation list scoped to the caller — every thread they
   * participate in. The optional [type] filter is what the seller
   * messages screen passes to hide BUYER_DELIVERY / SUPPORT noise
   * (seller only cares about BUYER_SELLER).
   */
  async listForUser(
    supabaseId: string,
    query: ListConversationsQueryDto,
  ): Promise<ConversationListItem[]> {
    const me = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!me) throw new NotFoundException('User profile not found');

    const limit = Math.min(query.limit ?? 50, 100);
    const offset = query.offset ?? 0;

    const rows = await this.prisma.db.conversation.findMany({
      where: {
        type: query.type ?? undefined,
        participants: { some: { userId: me.id } },
      },
      select: {
        id: true,
        type: true,
        orderId: true,
        storeId: true,
        lastMessage: true,
        lastMessageAt: true,
        createdAt: true,
        participants: {
          select: {
            userId: true,
            role: true,
            unreadCount: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatarPath: true,
                sellerProfile: { select: { displayName: true, profilePhotoUrl: true } },
              },
            },
          },
        },
      },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });

    return rows
      .map((c): ConversationListItem | null => {
        const mine = c.participants.find((p) => p.userId === me.id);
        const peer = c.participants.find((p) => p.userId !== me.id);
        if (!mine || !peer) return null;
        const fallback = [peer.user.firstName, peer.user.lastName]
          .filter((s) => s && s.length > 0)
          .join(' ')
          .trim();
        const sellerName = peer.user.sellerProfile?.displayName?.trim();
        const displayName =
          sellerName && sellerName.length > 0
            ? sellerName
            : fallback.length > 0
              ? fallback
              : peer.role === ParticipantRole.DELIVERY
                ? 'Livreur'
                : peer.role === ParticipantRole.SUPPORT
                  ? 'Support'
                  : 'Utilisateur';
        return {
          id: c.id,
          type: c.type,
          orderId: c.orderId,
          storeId: c.storeId,
          lastMessage: c.lastMessage,
          lastMessageAt: c.lastMessageAt,
          unreadCount: mine.unreadCount,
          myRole: mine.role,
          peer: {
            userId: peer.userId,
            displayName,
            avatarPath: peer.user.sellerProfile?.profilePhotoUrl ?? peer.user.avatarPath,
            role: peer.role,
          },
        };
      })
      .filter((c): c is ConversationListItem => c != null);
  }

  /**
   * Verifies the conversation exists and the caller is one of its
   * participants. Returns the caller's participant id (used for
   * marking as read) along with the conversation.
   */
  async assertParticipant(
    supabaseId: string,
    conversationId: string,
  ): Promise<{
    callerUserId: string;
    callerParticipantId: string;
    conversation: { id: string; type: ConversationType };
  }> {
    const me = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!me) throw new NotFoundException('User profile not found');

    const participant = await this.prisma.db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: me.id } },
      select: {
        id: true,
        conversation: { select: { id: true, type: true } },
      },
    });
    if (!participant) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }
    return {
      callerUserId: me.id,
      callerParticipantId: participant.id,
      conversation: participant.conversation,
    };
  }

  /** Resets the caller's `unreadCount` and stamps `lastReadAt`. */
  async markRead(supabaseId: string, conversationId: string): Promise<void> {
    const { callerParticipantId } = await this.assertParticipant(supabaseId, conversationId);
    await this.prisma.db.conversationParticipant.update({
      where: { id: callerParticipantId },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });
  }
}
