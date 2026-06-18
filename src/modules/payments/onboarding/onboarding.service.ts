import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';

import { UserRole } from '@common/enums/user-role.enum';

import { stripeConfig } from '@config/stripe.config';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { AccountLinkResponseDto } from './dto/account-link-response.dto';

import type { ConfigType } from '@nestjs/config';

/**
 * True when a Stripe error means the referenced Connect account doesn't exist
 * on this platform account (`resource_missing` / "No such account"). Used to
 * recover from a stale stored `stripeConnectAccountId`.
 */
function isNoSuchAccountError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === 'resource_missing' ||
    (typeof e.message === 'string' && e.message.includes('No such account'))
  );
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    @Inject(stripeConfig.KEY)
    private readonly cfg: ConfigType<typeof stripeConfig>,
  ) {}

  /**
   * Creates (or reuses) a Stripe Express Connect account for the seller or
   * driver, then mints an Account Link the Flutter app can open. Idempotent
   * across calls: if `stripeConnectAccountId` is already set, we just mint
   * a new link against the existing account.
   */
  async createAccountLink(supabaseId: string): Promise<AccountLinkResponseDto> {
    if (!this.cfg.onboardingReturnUrl || !this.cfg.onboardingRefreshUrl) {
      throw new InternalServerErrorException(
        'Stripe onboarding return/refresh URLs are not configured',
      );
    }

    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: { sellerProfile: true, driverProfile: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role !== UserRole.Seller && user.role !== UserRole.Driver) {
      throw new ForbiddenException('Only sellers and drivers go through Stripe Connect onboarding');
    }

    const profile = user.role === UserRole.Seller ? user.sellerProfile : user.driverProfile;
    if (!profile) {
      throw new NotFoundException('Complete your profile before starting Stripe onboarding');
    }

    try {
      let accountId = profile.stripeConnectAccountId ?? (await this.createExpressAccount(user));
      try {
        return await this.mintAccountLink(accountId);
      } catch (err) {
        // The stored Connect account id no longer exists on this Stripe
        // account — e.g. a seed placeholder (`acct_test_seed_seller`) or the
        // platform key was rotated to a different account. Recreate once
        // against a fresh Express account instead of failing the user.
        if (!isNoSuchAccountError(err)) throw err;
        accountId = await this.createExpressAccount(user);
        return await this.mintAccountLink(accountId);
      }
    } catch (err) {
      // Map any Stripe API failure to a clean, logged error so the app shows a
      // helpful message instead of a bare 500 (INCACOOK_UNKNOWN).
      this.rethrowMapped(err);
    }
  }

  /** Mints an account-onboarding link for an existing Connect account. */
  private async mintAccountLink(accountId: string): Promise<AccountLinkResponseDto> {
    const link = await this.stripe.client.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: this.cfg.onboardingReturnUrl,
      refresh_url: this.cfg.onboardingRefreshUrl,
    });
    return { url: link.url, expiresAt: link.expires_at };
  }

  /**
   * Turns a thrown error into a clear HTTP response. Stripe API errors (e.g.
   * "you haven't signed up for Connect", invalid country) are an upstream /
   * platform-config problem, not a server bug — surface them as 503 with a
   * user-safe message and log the real Stripe reason for the operator. Our own
   * HttpExceptions (NotFound / Forbidden) pass through untouched.
   */
  private rethrowMapped(err: unknown): never {
    if (err instanceof HttpException) throw err;

    if (err instanceof Stripe.errors.StripeError) {
      this.logger.error(
        `[StripeOnboarding] ${err.type} (status=${err.statusCode ?? '-'}): ${err.message}`,
      );
      // Connect not enabled on the platform account — the operator must turn
      // it on in the Stripe dashboard (https://dashboard.stripe.com/connect).
      if (/signed up for Connect|enable .*Connect|Connect settings/i.test(err.message)) {
        throw new ServiceUnavailableException(
          "La configuration des paiements n'est pas encore activée sur la plateforme. Réessayez plus tard.",
        );
      }
      throw new ServiceUnavailableException(
        'Configuration des paiements indisponible pour le moment. Réessayez plus tard.',
      );
    }

    this.logger.error(`[StripeOnboarding] unexpected error: ${String(err)}`);
    throw new ServiceUnavailableException(
      'Configuration des paiements indisponible pour le moment. Réessayez plus tard.',
    );
  }

  /**
   * Creates a fresh Express Connect account for the user and persists its id
   * on the matching profile so subsequent calls reuse it even if the user
   * abandons before clicking the link.
   */
  private async createExpressAccount(user: {
    id: string;
    email: string | null;
    role: string;
  }): Promise<string> {
    const created = await this.stripe.client.accounts.create({
      type: 'express',
      country: this.cfg.connectAccountCountry,
      email: user.email ?? undefined,
      // The user fills in business_type / individual details on Stripe's
      // hosted onboarding form — we don't pre-populate.
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      // Metadata lets the webhook handler find this profile without
      // querying both tables.
      metadata: {
        userId: user.id,
        role: user.role,
      },
    });

    if (user.role === UserRole.Seller) {
      await this.prisma.db.sellerProfile.update({
        where: { userId: user.id },
        data: { stripeConnectAccountId: created.id },
      });
    } else {
      await this.prisma.db.driverProfile.update({
        where: { userId: user.id },
        data: { stripeConnectAccountId: created.id },
      });
    }

    return created.id;
  }
}
