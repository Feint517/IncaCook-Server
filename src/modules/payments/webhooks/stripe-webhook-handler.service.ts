import { Injectable, Logger } from '@nestjs/common';

import { OrderStatus } from '@common/enums/order-status.enum';
import { UserRole } from '@common/enums/user-role.enum';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { NotificationsService } from '@modules/notifications/notifications.service';
import { subscriptionStatusFromStripe } from '@modules/subscriptions/subscription.util';

import type Stripe from 'stripe';

@Injectable()
export class StripeWebhookHandlerService {
  private readonly logger = new Logger(StripeWebhookHandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly stripe: StripeService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Broadcasts an order status change on the same Redis channel the
   * tracking gateway fans out to the buyer/seller sockets, so a webhook
   * confirmation updates the apps live (not only on next refresh).
   */
  private async publishStatus(orderId: string, status: OrderStatus): Promise<void> {
    try {
      await this.redis.client.publish(
        `order:${orderId}:status`,
        JSON.stringify({ orderId, status, at: new Date().toISOString() }),
      );
    } catch (err) {
      this.logger.warn(`status publish failed for ${orderId}: ${(err as Error).message}`);
    }
  }

  /**
   * Dispatches a verified Stripe event. Idempotent — Stripe may deliver
   * the same event multiple times. We handle this by always recomputing
   * the target state from `event.data.object` and using last-write-wins
   * semantics on the boolean flag.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'account.updated':
        await this.handleAccountUpdated(event.data.object as Stripe.Account);
        return;
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        return;
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        return;

      // ---- Seller platform subscription ($4/mo) ----
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        return;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.applySubscriptionState(event.data.object as Stripe.Subscription);
        return;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        return;

      default:
        // Other event types arrive as we wire up additional payment paths
        // (refunds, transfers, disputes). Debug log to avoid noisy prod.
        this.logger.debug(`Ignoring unhandled Stripe event: ${event.type}`);
    }
  }

  // ---------------------------------------------------------------------
  // Seller subscription handlers (source of truth for SellerProfile.*)
  // ---------------------------------------------------------------------

  /** checkout.session.completed — only subscription-mode sessions matter
   *  here; retrieve the subscription and write its state. */
  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    if (session.mode !== 'subscription') return; // ignore one-off payments
    const subId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subId) return;
    const sub = await this.stripe.client.subscriptions.retrieve(subId);
    await this.applySubscriptionState(sub);
  }

  /** invoice.payment_failed — re-read the subscription (now past_due /
   *  unpaid) and persist, so the seller is gated until they fix billing. */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subRef = (invoice as { subscription?: string | { id: string } | null }).subscription;
    const subId = typeof subRef === 'string' ? subRef : subRef?.id;
    if (!subId) return;
    const sub = await this.stripe.client.subscriptions.retrieve(subId);
    await this.applySubscriptionState(sub);
  }

  /**
   * Writes a Stripe Subscription's state onto the owning SellerProfile.
   * Resolves the seller from `subscription.metadata.userId` (stamped at
   * checkout) and falls back to the Stripe customer id. Idempotent.
   */
  private async applySubscriptionState(sub: Stripe.Subscription): Promise<void> {
    let sellerUserId: string | null = null;

    const metaUserId = sub.metadata?.userId;
    if (metaUserId) {
      const sp = await this.prisma.db.sellerProfile.findUnique({
        where: { userId: metaUserId },
        select: { userId: true },
      });
      if (sp) sellerUserId = sp.userId;
    }
    if (!sellerUserId) {
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      if (customerId) {
        const owner = await this.prisma.db.user.findFirst({
          where: { stripeCustomerId: customerId, sellerProfile: { isNot: null } },
          select: { id: true },
        });
        if (owner) sellerUserId = owner.id;
      }
    }
    if (!sellerUserId) {
      this.logger.warn(`subscription ${sub.id} — no matching seller profile`);
      return;
    }

    const periodEndUnix = (sub as { current_period_end?: number }).current_period_end;
    await this.prisma.db.sellerProfile.update({
      where: { userId: sellerUserId },
      data: {
        stripeSubscriptionId: sub.id,
        subscriptionStatus: subscriptionStatusFromStripe(sub.status),
        subscriptionCurrentPeriodEnd: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Catalog purchases (seller buys admin products) — webhook backstop for
  // the in-app server-verified confirm.
  // ---------------------------------------------------------------------

  private async catalogOrderIdFor(pi: Stripe.PaymentIntent): Promise<string | null> {
    const metaId = pi.metadata?.catalogOrderId;
    if (metaId) return metaId;
    const byPi = await this.prisma.db.catalogOrder.findUnique({
      where: { stripePaymentIntentId: pi.id },
      select: { id: true },
    });
    return byPi?.id ?? null;
  }

  private async markCatalogOrderPaid(pi: Stripe.PaymentIntent): Promise<void> {
    const id = await this.catalogOrderIdFor(pi);
    if (!id) {
      this.logger.warn(`catalog payment_intent.succeeded ${pi.id} — no order`);
      return;
    }
    await this.prisma.db.catalogOrder.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date(), stripePaymentIntentId: pi.id },
    });
  }

  private async markCatalogOrderFailed(pi: Stripe.PaymentIntent): Promise<void> {
    const id = await this.catalogOrderIdFor(pi);
    if (!id) return;
    await this.prisma.db.catalogOrder.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
  }

  // ---------------------------------------------------------------------
  // PaymentIntent handlers (Slice A: order placement)
  // ---------------------------------------------------------------------

  /**
   * payment_intent.succeeded — buyer's card has been charged. Transition
   * the order to CONFIRMED. Idempotent: if already CONFIRMED (or further
   * along), no-op.
   *
   * Order lookup priority:
   *   1. metadata.orderId (set at PaymentIntent creation)
   *   2. stripePaymentIntentId on Order (in case our post-create update
   *      had succeeded)
   *
   * Backfills `stripePaymentIntentId` if it's null — the post-create update
   * may have failed (network glitch, app crash) and the webhook is the
   * second chance to record it.
   */
  private async handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent): Promise<void> {
    // Catalog purchases (seller buying admin products) ride the same event
    // but live in a different table — handle + return before order logic.
    if (pi.metadata?.type === 'catalog_order') {
      await this.markCatalogOrderPaid(pi);
      return;
    }

    const order = await this.findOrderForPaymentIntent(pi);
    if (!order) {
      this.logger.warn(`payment_intent.succeeded for ${pi.id} — no matching order`);
      return;
    }

    if (order.status !== OrderStatus.Pending) {
      // Already confirmed (idempotent retry) or moved further along —
      // we're not the source of truth past CONFIRMED.
      return;
    }

    await this.prisma.db.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.Confirmed,
        confirmedAt: new Date(),
        ...(order.stripePaymentIntentId ? {} : { stripePaymentIntentId: pi.id }),
      },
    });
    await this.publishStatus(order.id, OrderStatus.Confirmed);
    // Notify the seller — this is the backstop path (the buyer-triggered
    // confirmPaymentForBuyer notifies too, but both are guarded by the
    // PENDING check above so the seller is notified exactly once).
    // notifyOrderPaid swallows its own errors.
    await this.notifications.notifyOrderPaid(order.sellerId, order.id);
  }

  /**
   * payment_intent.payment_failed / .canceled — money won't arrive. Mark
   * the order CANCELLED and restore the inventory we decremented at
   * order creation (idempotent via the `inventoryRestored` flag).
   */
  private async handlePaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<void> {
    if (pi.metadata?.type === 'catalog_order') {
      await this.markCatalogOrderFailed(pi);
      return;
    }

    const order = await this.findOrderForPaymentIntent(pi);
    if (!order) {
      this.logger.warn(`payment_intent.failed/canceled for ${pi.id} — no matching order`);
      return;
    }

    if (order.status === OrderStatus.Cancelled) {
      // Already cancelled (idempotent retry).
      return;
    }
    if (order.status !== OrderStatus.Pending) {
      // Past PENDING — confirmed-then-failed is a different recovery flow
      // (refund + clawback) and doesn't belong in payment_intent failures.
      this.logger.warn(
        `payment_intent.failed for ${pi.id}: order ${order.id} is in ${order.status}, not PENDING — leaving alone`,
      );
      return;
    }

    const reason = pi.last_payment_error?.message ?? pi.cancellation_reason ?? 'payment_failed';

    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.order.findUnique({
        where: { id: order.id },
        select: {
          status: true,
          inventoryRestored: true,
          items: { select: { listingId: true, quantity: true } },
        },
      });
      if (!fresh || fresh.status !== OrderStatus.Pending) {
        return; // raced with another delivery of the same event
      }

      if (!fresh.inventoryRestored) {
        // Aggregate by listing in case the same listing appears in multiple items.
        const restoreByListing = new Map<string, number>();
        for (const item of fresh.items) {
          restoreByListing.set(
            item.listingId,
            (restoreByListing.get(item.listingId) ?? 0) + item.quantity,
          );
        }
        for (const [listingId, qty] of restoreByListing) {
          await tx.$executeRaw`
            UPDATE "Listing"
            SET "portionsLeft" = "portionsLeft" + ${qty}
            WHERE "id" = ${listingId}
          `;
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.Cancelled,
          cancelledAt: new Date(),
          cancellationReason: reason,
          inventoryRestored: true,
          ...(order.stripePaymentIntentId ? {} : { stripePaymentIntentId: pi.id }),
        },
      });
    });
    await this.publishStatus(order.id, OrderStatus.Cancelled);
  }

  private async findOrderForPaymentIntent(pi: Stripe.PaymentIntent): Promise<{
    id: string;
    sellerId: string;
    status: string;
    stripePaymentIntentId: string | null;
  } | null> {
    const orderId = pi.metadata?.orderId;
    if (orderId) {
      const byMetadata = await this.prisma.db.order.findUnique({
        where: { id: orderId },
        select: { id: true, sellerId: true, status: true, stripePaymentIntentId: true },
      });
      if (byMetadata) return byMetadata;
    }

    return this.prisma.db.order.findUnique({
      where: { stripePaymentIntentId: pi.id },
      select: { id: true, sellerId: true, status: true, stripePaymentIntentId: true },
    });
  }

  // ---------------------------------------------------------------------
  // account.updated handler (Stripe Connect onboarding)
  // ---------------------------------------------------------------------

  private async handleAccountUpdated(account: Stripe.Account): Promise<void> {
    const onboardingCompleted =
      Boolean(account.charges_enabled) &&
      Boolean(account.payouts_enabled) &&
      Boolean(account.details_submitted);

    // Prefer routing by the metadata.role we set at account creation.
    // Fall back to looking up by stripeConnectAccountId across both tables
    // — defends against accounts created out-of-band (e.g. by support).
    const role = account.metadata?.role as UserRole | undefined;

    if (role === UserRole.Seller) {
      await this.updateSellerOnboarding(account.id, onboardingCompleted);
      return;
    }
    if (role === UserRole.Driver) {
      await this.updateDriverOnboarding(account.id, onboardingCompleted);
      return;
    }

    // Fallback: try both tables.
    const sellerHit = await this.prisma.db.sellerProfile.findUnique({
      where: { stripeConnectAccountId: account.id },
      select: { userId: true },
    });
    if (sellerHit) {
      await this.updateSellerOnboarding(account.id, onboardingCompleted);
      return;
    }

    const driverHit = await this.prisma.db.driverProfile.findUnique({
      where: { stripeConnectAccountId: account.id },
      select: { userId: true },
    });
    if (driverHit) {
      await this.updateDriverOnboarding(account.id, onboardingCompleted);
      return;
    }

    this.logger.warn(`account.updated for ${account.id} — no matching seller/driver profile found`);
  }

  private async updateSellerOnboarding(accountId: string, completed: boolean): Promise<void> {
    await this.prisma.db.sellerProfile.updateMany({
      where: { stripeConnectAccountId: accountId },
      data: { stripeOnboardingCompleted: completed },
    });
  }

  private async updateDriverOnboarding(accountId: string, completed: boolean): Promise<void> {
    await this.prisma.db.driverProfile.updateMany({
      where: { stripeConnectAccountId: accountId },
      data: { stripeOnboardingCompleted: completed },
    });
  }
}
