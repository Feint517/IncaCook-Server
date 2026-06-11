import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';

import { UserRole } from '@common/enums/user-role.enum';

import { stripeConfig } from '@config/stripe.config';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { isSubscriptionActive, subscriptionStatusFromStripe } from './subscription.util';

import type Stripe from 'stripe';

/**
 * Owns the seller platform subscription ($4/mo): Stripe Checkout to
 * subscribe, the Billing Portal to manage, and the read of current state.
 * Stripe is the source of truth — the DB columns are written by the
 * subscription webhooks (see StripeWebhookHandlerService), not here.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    @Inject(stripeConfig.KEY) private readonly cfg: ConfigType<typeof stripeConfig>,
  ) {}

  /**
   * Current subscription state for the seller's dashboard / paywall. When
   * the local state isn't active but a Stripe subscription id exists, it
   * lazily re-reads Stripe and writes the result first — so a just-paid
   * seller flips to active immediately, without waiting on the webhook.
   */
  async getStatus(supabaseId: string): Promise<SubscriptionResponseDto> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: {
        id: true,
        sellerProfile: {
          select: {
            subscriptionStatus: true,
            subscriptionCurrentPeriodEnd: true,
            stripeSubscriptionId: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User profile not found');
    let sp = user.sellerProfile;

    if (
      sp?.stripeSubscriptionId &&
      !isSubscriptionActive(sp.subscriptionStatus, sp.subscriptionCurrentPeriodEnd)
    ) {
      try {
        const sub = await this.stripe.client.subscriptions.retrieve(sp.stripeSubscriptionId);
        await this.writeStateFromSub(user.id, sub);
        sp = {
          subscriptionStatus: subscriptionStatusFromStripe(sub.status),
          subscriptionCurrentPeriodEnd: this.periodEnd(sub),
          stripeSubscriptionId: sub.id,
        };
      } catch {
        // keep local state if Stripe lookup fails
      }
    }

    const status = sp?.subscriptionStatus ?? 'NONE';
    const periodEnd = sp?.subscriptionCurrentPeriodEnd ?? null;
    return {
      status,
      currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
      active: isSubscriptionActive(sp?.subscriptionStatus, periodEnd),
    };
  }

  /**
   * In-app subscribe: creates (or reuses) a `default_incomplete`
   * subscription for the $4/mo price and returns the first invoice's
   * PaymentIntent client secret. The app confirms it with the card via
   * `flutter_stripe` (same as buyer checkout); the webhook then flips the
   * seller to active. Rejects if already active.
   */
  async createSubscription(supabaseId: string): Promise<{
    clientSecret: string | null;
    subscriptionId: string;
    status: string;
  }> {
    const priceId = this.cfg.sellerSubscriptionPriceId;
    if (!priceId) {
      throw new ServiceUnavailableException('Subscription plan is not configured');
    }
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: {
        id: true,
        email: true,
        role: true,
        stripeCustomerId: true,
        sellerProfile: {
          select: {
            subscriptionStatus: true,
            subscriptionCurrentPeriodEnd: true,
            stripeSubscriptionId: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User profile not found');
    if (user.role !== UserRole.Seller || !user.sellerProfile) {
      throw new ForbiddenException('Only sellers can subscribe');
    }
    if (
      isSubscriptionActive(
        user.sellerProfile.subscriptionStatus,
        user.sellerProfile.subscriptionCurrentPeriodEnd,
      )
    ) {
      throw new ConflictException('Subscription is already active');
    }

    // Reuse a still-incomplete subscription instead of stacking duplicates.
    const existingId = user.sellerProfile.stripeSubscriptionId;
    if (existingId) {
      try {
        const existing = await this.stripe.client.subscriptions.retrieve(existingId, {
          expand: ['latest_invoice.payment_intent'],
        });
        if (existing.status === 'active' || existing.status === 'trialing') {
          await this.writeStateFromSub(user.id, existing);
          throw new ConflictException('Subscription is already active');
        }
        if (existing.status === 'incomplete') {
          return {
            clientSecret: this.clientSecretOf(existing),
            subscriptionId: existing.id,
            status: existing.status,
          };
        }
      } catch (e) {
        if (e instanceof ConflictException) throw e;
        // not retrievable — fall through and create a fresh one
      }
    }

    const customerId = await this.ensureCustomer(user.id, user.email, user.stripeCustomerId);

    const sub = await this.stripe.client.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { userId: user.id, type: 'seller_subscription' },
    });

    await this.writeStateFromSub(user.id, sub);

    return {
      clientSecret: this.clientSecretOf(sub),
      subscriptionId: sub.id,
      status: sub.status,
    };
  }

  /** Pulls the first-invoice PaymentIntent client secret off a subscription. */
  private clientSecretOf(sub: Stripe.Subscription): string | null {
    const invoice = sub.latest_invoice;
    if (!invoice || typeof invoice === 'string') return null;
    const pi = (
      invoice as unknown as {
        payment_intent?: Stripe.PaymentIntent | string | null;
      }
    ).payment_intent;
    if (!pi || typeof pi === 'string') return null;
    return pi.client_secret;
  }

  private periodEnd(sub: Stripe.Subscription): Date | null {
    const unix = (sub as { current_period_end?: number }).current_period_end;
    return unix ? new Date(unix * 1000) : null;
  }

  /** Mirrors a Stripe subscription onto the seller's profile row. */
  private async writeStateFromSub(userId: string, sub: Stripe.Subscription): Promise<void> {
    await this.prisma.db.sellerProfile.update({
      where: { userId },
      data: {
        stripeSubscriptionId: sub.id,
        subscriptionStatus: subscriptionStatusFromStripe(sub.status),
        subscriptionCurrentPeriodEnd: this.periodEnd(sub),
      },
    });
  }

  /** Creates a Stripe Billing Portal session (update card / cancel /
   *  invoices) and returns its hosted URL. */
  async createPortalSession(supabaseId: string): Promise<{ url: string }> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true, stripeCustomerId: true },
    });
    if (!user) throw new NotFoundException('User profile not found');
    if (user.role !== UserRole.Seller) {
      throw new ForbiddenException('Only sellers have a subscription portal');
    }
    if (!user.stripeCustomerId) {
      throw new ConflictException('No billing account yet — subscribe first');
    }
    const session = await this.stripe.client.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: this.cfg.portalReturnUrl || 'https://incacook.app/account',
    });
    return { url: session.url };
  }

  /**
   * Reuses the user's Stripe customer when valid; otherwise creates one
   * and persists it. Mirrors the orders-service guard so a stale
   * `cus_dev_…` / cross-account id doesn't break checkout.
   */
  private async ensureCustomer(
    userId: string,
    email: string,
    existing: string | null,
  ): Promise<string> {
    if (existing && !existing.startsWith('cus_dev_')) {
      try {
        const found = await this.stripe.client.customers.retrieve(existing);
        if (!(found as { deleted?: boolean }).deleted) return existing;
      } catch {
        // not found in this account — recreate below
      }
    }
    const customer = await this.stripe.client.customers.create({
      email,
      metadata: { userId },
    });
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }
}
