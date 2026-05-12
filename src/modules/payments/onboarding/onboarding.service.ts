import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { UserRole } from '@common/enums/user-role.enum';

import { stripeConfig } from '@config/stripe.config';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { AccountLinkResponseDto } from './dto/account-link-response.dto';

/** Country for Connect Express accounts. v1 is EUR-only / FR-only. */
const ACCOUNT_COUNTRY = 'FR';

@Injectable()
export class OnboardingService {
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

    const profile =
      user.role === UserRole.Seller ? user.sellerProfile : user.driverProfile;
    if (!profile) {
      throw new NotFoundException('Complete your profile before starting Stripe onboarding');
    }

    let accountId = profile.stripeConnectAccountId;
    if (!accountId) {
      const created = await this.stripe.client.accounts.create({
        type: 'express',
        country: ACCOUNT_COUNTRY,
        email: user.email,
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
      accountId = created.id;

      // Persist immediately so subsequent calls reuse the same account even
      // if the user abandons before clicking the link.
      if (user.role === UserRole.Seller) {
        await this.prisma.db.sellerProfile.update({
          where: { userId: user.id },
          data: { stripeConnectAccountId: accountId },
        });
      } else {
        await this.prisma.db.driverProfile.update({
          where: { userId: user.id },
          data: { stripeConnectAccountId: accountId },
        });
      }
    }

    const link = await this.stripe.client.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: this.cfg.onboardingReturnUrl,
      refresh_url: this.cfg.onboardingRefreshUrl,
    });

    return { url: link.url, expiresAt: link.expires_at };
  }
}
