import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { FcmService } from '@infrastructure/notifications/push/fcm.service';

import { DeviceTokensService } from './device-tokens.service';

/** FCM copy for buyer-facing order status pushes. Types/strings match the
 *  Phase-1 notification spec exactly. */
const ORDER_STATUS_COPY = {
  order_preparing: {
    title: 'Commande en préparation',
    body: 'Votre commande est en cours de préparation.',
  },
  order_ready: { title: 'Commande prête', body: 'Votre commande est prête.' },
  order_cancelled: {
    title: 'Commande annulée',
    body: 'Votre commande a été annulée.',
  },
} as const;

/** FCM copy for delivery lifecycle pushes (buyer/seller). */
const DELIVERY_EVENT_COPY = {
  delivery_assigned: {
    title: 'Livreur assigné',
    body: 'Un livreur a été assigné à votre commande.',
  },
  driver_at_pickup: {
    title: 'Le livreur est arrivé',
    body: 'Le livreur est arrivé chez le vendeur.',
  },
  order_picked_up: {
    title: 'Commande récupérée',
    body: 'Votre commande est en route.',
  },
  delivery_completed: {
    title: 'Commande livrée',
    body: 'Votre commande a été livrée.',
  },
} as const;

type OrderStatusEvent = keyof typeof ORDER_STATUS_COPY;
type DeliveryEvent = keyof typeof DELIVERY_EVENT_COPY;

export interface TestNotificationResult {
  /** Whether Firebase Admin credentials are configured (push can be sent). */
  fcmReady: boolean;
  /** Number of registered tokens for the user. */
  tokens: number;
  /** Number of pushes actually dispatched (0 when fcmReady is false). */
  sent: number;
}

/**
 * Thin orchestration over [DeviceTokensService] + [FcmService] for the
 * developer test endpoint. Full per-event notification dispatch (orders,
 * messages, deliveries) is a later task — this only proves the pipe works.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly deviceTokens: DeviceTokensService,
    private readonly fcm: FcmService,
    private readonly prisma: PrismaService,
  ) {}

  /** Sends a canned test push to every device the current user registered. */
  async sendTestToUser(supabaseId: string): Promise<TestNotificationResult> {
    const userId = await this.deviceTokens.resolveUserId(supabaseId);
    const tokens = await this.deviceTokens.listTokensForUser(userId);
    const fcmReady = this.fcm.isReady();

    if (!fcmReady) {
      this.logger.warn('Test notification requested but FCM is not configured; skipping send.');
      return { fcmReady, tokens: tokens.length, sent: 0 };
    }

    let sent = 0;
    for (const token of tokens) {
      await this.fcm.sendToToken(token, {
        notification: {
          title: 'IncaCook',
          body: 'Test notification ✅',
        },
        data: { type: 'TEST' },
      });
      sent += 1;
    }

    return { fcmReady, tokens: tokens.length, sent };
  }

  /**
   * Bulk push to a set of users (admin targeted broadcast). Reuses the
   * DeviceToken table + FcmService. Never throws on individual token
   * failures; prunes tokens Firebase reports as invalid. Returns counts.
   *
   * @param data string map merged into the FCM data payload.
   */
  async sendToUsers(
    userIds: string[],
    notification: { title: string; body: string; data?: Record<string, string> },
  ): Promise<{ tokensFound: number; sent: number; failed: number; invalidRemoved: number }> {
    const tokens = await this.deviceTokens.tokensForUsers(userIds);
    if (tokens.length === 0) {
      return { tokensFound: 0, sent: 0, failed: 0, invalidRemoved: 0 };
    }

    let sent = 0;
    let failed = 0;
    const invalidIds: string[] = [];
    for (const { id, token } of tokens) {
      const res = await this.fcm.sendToTokenWithResult(token, {
        notification: { title: notification.title, body: notification.body },
        data: notification.data,
      });
      if (res.delivered) {
        sent += 1;
      } else {
        failed += 1;
        if (res.invalidToken) invalidIds.push(id);
      }
    }

    const invalidRemoved = await this.deviceTokens.deleteByIds(invalidIds);
    this.logger.log(
      `[admin-push] users=${userIds.length} tokens=${tokens.length} sent=${sent} failed=${failed} pruned=${invalidRemoved}`,
    );
    return { tokensFound: tokens.length, sent, failed, invalidRemoved };
  }

  /**
   * Notifies a seller that one of their orders was just paid — i.e. the
   * buyer's payment is confirmed and the order has reached CONFIRMED.
   * No-op when the seller has no registered device. Per-token send errors
   * are swallowed by [FcmService]; callers also wrap this so it can never
   * break payment confirmation.
   *
   * @param sellerUserId local `User.id` of the seller (Order.sellerId).
   */
  async notifyOrderPaid(sellerUserId: string, orderId: string): Promise<void> {
    try {
      const tokens = await this.deviceTokens.listTokensForUser(sellerUserId);
      if (tokens.length === 0) return;
      for (const token of tokens) {
        await this.fcm.sendToToken(token, {
          notification: {
            title: 'Nouvelle commande payée',
            body: 'Vous avez reçu une nouvelle commande.',
          },
          data: { type: 'order_paid', orderId },
        });
      }
    } catch (err) {
      // Never let a notification problem bubble into payment confirmation.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`order_paid notification failed for order ${orderId}: ${reason}`);
    }
  }

  // -------------------------------------------------------------------------
  // Per-event business notifications (buyer order status + deliveries). Every
  // method is best-effort and fully self-contained in try/catch so a push
  // failure can NEVER break the order/delivery operation that triggered it.
  // -------------------------------------------------------------------------

  /** Buyer push for a user-facing order status change. */
  async notifyOrderStatus(orderId: string, event: OrderStatusEvent): Promise<void> {
    const buyerId = await this.orderBuyerId(orderId);
    if (!buyerId) return;
    const copy = ORDER_STATUS_COPY[event];
    await this.dispatch([buyerId], copy.title, copy.body, { type: event, orderId });
  }

  /** Buyer/seller push for a delivery lifecycle event. */
  async notifyDeliveryEvent(
    orderId: string,
    deliveryId: string,
    event: DeliveryEvent,
    audience: { buyer?: boolean; seller?: boolean },
  ): Promise<void> {
    const parties = await this.orderParties(orderId);
    if (!parties) return;
    const ids: string[] = [];
    if (audience.buyer) ids.push(parties.buyerId);
    if (audience.seller) ids.push(parties.sellerId);
    const copy = DELIVERY_EVENT_COPY[event];
    await this.dispatch(ids, copy.title, copy.body, {
      type: event,
      orderId,
      deliveryId,
    });
  }

  /**
   * Push to every ONLINE driver that a new delivery is up for grabs. Mirrors
   * the open-dispatch matching (listAvailable offers each SEARCHING job to
   * all online drivers; proximity is a soft ordering, not a hard filter), so
   * we target that same set rather than all drivers.
   */
  async notifyDeliveryAvailable(orderId: string, deliveryId: string): Promise<void> {
    try {
      const drivers = await this.prisma.db.driverProfile.findMany({
        where: { isOnline: true },
        select: { userId: true },
      });
      const ids = drivers.map((d) => d.userId);
      if (ids.length === 0) return;
      await this.dispatch(
        ids,
        'Nouvelle livraison disponible',
        'Une livraison est disponible près de vous.',
        { type: 'delivery_available', orderId, deliveryId },
      );
    } catch (err) {
      this.warnNotify('delivery_available', orderId, err);
    }
  }

  // --- internals ---

  private async orderBuyerId(orderId: string): Promise<string | null> {
    const o = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true },
    });
    return o?.buyerId ?? null;
  }

  private async orderParties(
    orderId: string,
  ): Promise<{ buyerId: string; sellerId: string } | null> {
    return this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: { buyerId: true, sellerId: true },
    });
  }

  /**
   * Sends one push per registered token of [userIds]; prunes tokens Firebase
   * reports as invalid. Fully wrapped — never throws into the caller.
   */
  private async dispatch(
    userIds: string[],
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<void> {
    try {
      const ids = Array.from(new Set(userIds.filter(Boolean)));
      if (ids.length === 0) return;
      const tokens = await this.deviceTokens.tokensForUsers(ids);
      if (tokens.length === 0) return;
      const invalidIds: string[] = [];
      for (const { id, token } of tokens) {
        const res = await this.fcm.sendToTokenWithResult(token, {
          notification: { title, body },
          data,
        });
        if (!res.delivered && res.invalidToken) invalidIds.push(id);
      }
      if (invalidIds.length > 0) await this.deviceTokens.deleteByIds(invalidIds);
    } catch (err) {
      this.warnNotify(data.type ?? 'notify', data.orderId ?? '', err);
    }
  }

  private warnNotify(type: string, orderId: string, err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.warn(`[notify ${type}] failed for order ${orderId}: ${reason}`);
  }
}
