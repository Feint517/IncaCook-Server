import { Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';

import { OrderStatus } from '@common/enums/order-status.enum';
import { UserRole } from '@common/enums/user-role.enum';

import { PrismaService } from '@infrastructure/database/prisma.service';

@Injectable()
export class StripeWebhookHandlerService {
  private readonly logger = new Logger(StripeWebhookHandlerService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      default:
        // Other event types arrive as we wire up additional payment paths
        // (refunds, transfers, disputes). Debug log to avoid noisy prod.
        this.logger.debug(`Ignoring unhandled Stripe event: ${event.type}`);
    }
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
  }

  /**
   * payment_intent.payment_failed / .canceled — money won't arrive. Mark
   * the order CANCELLED and restore the inventory we decremented at
   * order creation (idempotent via the `inventoryRestored` flag).
   */
  private async handlePaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<void> {
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

    const reason =
      pi.last_payment_error?.message ?? pi.cancellation_reason ?? 'payment_failed';

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
  }

  private async findOrderForPaymentIntent(
    pi: Stripe.PaymentIntent,
  ): Promise<{
    id: string;
    status: string;
    stripePaymentIntentId: string | null;
  } | null> {
    const orderId = pi.metadata?.orderId;
    if (orderId) {
      const byMetadata = await this.prisma.db.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, stripePaymentIntentId: true },
      });
      if (byMetadata) return byMetadata;
    }

    return this.prisma.db.order.findUnique({
      where: { stripePaymentIntentId: pi.id },
      select: { id: true, status: true, stripePaymentIntentId: true },
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

    this.logger.warn(
      `account.updated for ${account.id} — no matching seller/driver profile found`,
    );
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
