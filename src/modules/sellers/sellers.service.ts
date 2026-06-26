import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SellerCategory, SubscriptionStatus } from '@prisma/client';

import { DELIVERY_FEE_CENTS } from '@common/constants/pricing.constants';
import { maxRadiusForCategory } from '@common/constants/seller-radius.constants';
import { UserRole } from '@common/enums/user-role.enum';

import { revenueCatConfig } from '@config/revenuecat.config';

import { PrismaService } from '@infrastructure/database/prisma.service';

import {
  activeStatusForPeriod,
  buildSubscriptionFields,
  pickActiveEntitlement,
} from '@modules/subscriptions/revenuecat.util';

import { KitchenSummaryDto } from './dto/kitchen-summary.dto';
import {
  toSellerSubscriptionResponse,
  type SellerSubscriptionResponseDto,
} from './dto/seller-subscription-response.dto';
import { SyncSubscriptionDto } from './dto/sync-subscription.dto';
import { UpsertSellerBusinessDto } from './dto/upsert-seller-business.dto';
import { UpsertSellerCuisinesDto } from './dto/upsert-seller-cuisines.dto';
import { UpsertSellerProfileDto } from './dto/upsert-seller-profile.dto';

import type { ConfigType } from '@nestjs/config';
import type {
  CuisineType,
  DayOfWeek,
  DishType,
  SellerBusiness,
  SellerProfile,
} from '@prisma/client';

/**
 * Default platform delivery fee stored on the seller profile when none is
 * supplied. Sourced from the shared pricing constant (5,00 €) so it never
 * diverges from the fee OrdersService actually charges. Order pricing uses the
 * flat [DELIVERY_FEE_CENTS] directly; this just keeps the profile column in
 * sync and non-null so the seller can immediately receive orders.
 */
const DEFAULT_DELIVERY_FEE_CENTS = DELIVERY_FEE_CENTS;

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(revenueCatConfig.KEY)
    private readonly rcConfig: ConfigType<typeof revenueCatConfig>,
  ) {}

  // -------------------- RevenueCat subscription --------------------

  /**
   * Reconciles the seller's RevenueCat subscription after a purchase/restore.
   * When a secret REST key is configured we VERIFY the subscriber against
   * RevenueCat rather than trusting the client; otherwise we apply the client
   * hint optimistically (the webhook reconciles authoritatively either way).
   *
   * Writes the shared gate fields (`subscriptionStatus` /
   * `subscriptionCurrentPeriodEnd` / `isPremium`) so existing listing/commission
   * logic honours RevenueCat with no further changes.
   */
  async syncRevenueCatSubscription(
    supabaseId: string,
    dto: SyncSubscriptionDto,
  ): Promise<SellerSubscriptionResponseDto> {
    const userId = await this.assertSeller(supabaseId);

    const verified = await this.verifyWithRevenueCat(userId);

    // Prefer the REST-verified entitlement, but fall back to the client hint
    // field-by-field when verification found none. Right after a purchase the
    // entitlement can lag in RevenueCat's REST API (sandbox especially), so a
    // verified `{ entitlement: null }` must NOT override a just-bought seller's
    // hint — otherwise they'd be locked out and re-prompted to pay. The webhook
    // reconciles the authoritative state regardless.
    const entitlement = verified?.entitlement ?? dto.entitlementId ?? null;
    const productId = verified?.productId ?? dto.productId ?? null;
    const expiresAtMs = verified?.expiresAtMs ?? dto.expiresAtMs ?? null;
    const isTrial = verified?.isTrial ?? dto.isTrial ?? false;

    const status = entitlement
      ? activeStatusForPeriod(isTrial ? 'TRIAL' : 'NORMAL')
      : SubscriptionStatus.NONE;

    const updated = await this.prisma.db.sellerProfile.update({
      where: { userId },
      // buildSubscriptionFields applies the +1-month fallback so a successful
      // activation never persists a null expiry (test mode / no expiry).
      data: buildSubscriptionFields({
        status,
        entitlement,
        productId,
        expiresAtMs,
        isTrial,
        category: dto.category ?? null,
        revenueCatCustomerId: dto.revenueCatCustomerId ?? userId,
      }),
    });
    this.logger.log(
      `[SubscriptionSync] status=${updated.subscriptionStatus} ` +
        `plan=${updated.subscriptionPlan ?? 'none'} ` +
        `expiresAt=${updated.subscriptionCurrentPeriodEnd?.toISOString() ?? 'null'}`,
    );
    return toSellerSubscriptionResponse(updated);
  }

  /**
   * Server-side verification via RevenueCat's REST API. Returns the active
   * seller entitlement (premium wins) or null if none. Returns null (caller
   * falls back to the client hint) when no secret key is configured or the
   * call fails — the webhook remains the source of truth. Never throws.
   */
  private async verifyWithRevenueCat(appUserId: string): Promise<{
    entitlement: string | null;
    productId: string | null;
    expiresAtMs: number | null;
    isTrial: boolean;
  } | null> {
    const key = this.rcConfig.secretApiKey;
    if (!key) return null;
    try {
      const res = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
        { headers: { Authorization: `Bearer ${key}` } },
      );
      if (!res.ok) {
        this.logger.warn(`RevenueCat verify failed: HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        subscriber?: {
          entitlements?: Record<
            string,
            { expires_date?: string | null; product_identifier?: string }
          >;
          subscriptions?: Record<string, { period_type?: string; expires_date?: string | null }>;
        };
      };
      const entitlements = body.subscriber?.entitlements ?? {};
      const nowMs = Date.now();
      const activeIds = Object.entries(entitlements)
        .filter(([, e]) => !e.expires_date || new Date(e.expires_date).getTime() > nowMs)
        .map(([id]) => id);
      const entitlement = pickActiveEntitlement(activeIds);
      if (!entitlement) {
        return { entitlement: null, productId: null, expiresAtMs: null, isTrial: false };
      }
      const ent = entitlements[entitlement];
      const productId = ent?.product_identifier ?? null;
      const expiresAtMs = ent?.expires_date ? new Date(ent.expires_date).getTime() : null;
      const sub = productId ? body.subscriber?.subscriptions?.[productId] : undefined;
      const isTrial = (sub?.period_type ?? '').toLowerCase() === 'trial';
      return { entitlement, productId, expiresAtMs, isTrial };
    } catch (err) {
      this.logger.warn(`RevenueCat verify error: ${(err as Error).message}`);
      return null;
    }
  }

  // -------------------- Buyer-facing feed --------------------

  /**
   * "Kitchens near you" — active sellers that have set up a profile
   * (`displayName` present) on a non-deleted user. Ordered by rating then
   * review count. Distance filtering is a follow-up; v1 returns the top set.
   */
  async listKitchens(): Promise<KitchenSummaryDto[]> {
    const sellers = await this.prisma.db.sellerProfile.findMany({
      where: {
        displayName: { not: null },
        // Suspended sellers are hidden from the buyer "kitchens" feed.
        user: { deletedAt: null, isSuspended: false },
      },
      include: { cuisines: true },
      orderBy: [{ averageRating: { sort: 'desc', nulls: 'last' } }, { reviewCount: 'desc' }],
      take: 50,
    });
    return sellers.map((s) => KitchenSummaryDto.from(s));
  }

  // -------------------- Profile --------------------

  async upsertProfile(supabaseId: string, dto: UpsertSellerProfileDto): Promise<SellerProfile> {
    const userId = await this.assertSeller(supabaseId);

    // prepMin/prepMax sanity check.
    if (
      dto.prepMinMinutes !== undefined &&
      dto.prepMaxMinutes !== undefined &&
      dto.prepMaxMinutes < dto.prepMinMinutes
    ) {
      throw new BadRequestException('prepMaxMinutes must be >= prepMinMinutes');
    }

    // Category-specific delivery-radius cap (Traiteur 50 km; fait-maison /
    // restaurant 10 km). The seller is explicitly configuring here, so we
    // REJECT an over-cap value with a clear message rather than silently
    // clamping. Only validated when a radius is actually supplied — the
    // onboarding flow omits it (defaults to null), so this is purely an
    // API-misuse guard and never breaks normal signup.
    if (dto.deliveryRadiusKm != null && dto.deliveryRadiusKm > maxRadiusForCategory(dto.category)) {
      throw new BadRequestException(
        `deliveryRadiusKm dépasse le maximum autorisé (${maxRadiusForCategory(dto.category)} km) pour cette catégorie.`,
      );
    }

    // FAIT_MAISON auto-approves KYC; everyone else stays PENDING until
    // documents land + admin reviews. We only flip kycStatus when category
    // is being set — never demote APPROVED.
    const next = await this.prisma.db.sellerProfile.findUnique({
      where: { userId },
      select: { kycStatus: true, category: true },
    });

    const nextKycStatus =
      dto.category === SellerCategory.FAIT_MAISON && next?.kycStatus === 'PENDING'
        ? 'APPROVED'
        : undefined;

    return this.prisma.db.sellerProfile.update({
      where: { userId },
      data: {
        category: dto.category,
        displayName: dto.displayName,
        bio: dto.bio ?? null,
        profilePhotoUrl: dto.profilePhotoUrl,
        dateOfBirth: new Date(dto.dateOfBirth),
        neighborhood: dto.neighborhood ?? null,
        deliveryRadiusKm: dto.deliveryRadiusKm ?? null,
        // Fixed €2.50 fee for every category; default it when the client
        // omits it so the seller can immediately receive orders.
        deliveryFeeCents: dto.deliveryFeeCents ?? DEFAULT_DELIVERY_FEE_CENTS,
        prepMinMinutes: dto.prepMinMinutes ?? null,
        prepMaxMinutes: dto.prepMaxMinutes ?? null,
        hygieneCommitment: dto.hygieneCommitment ?? null,
        faitMaisonCommitment: dto.faitMaisonCommitment ?? null,
        ...(nextKycStatus ? { kycStatus: nextKycStatus } : {}),
      },
    });
  }

  // -------------------- Business --------------------

  async upsertBusiness(
    supabaseId: string,
    dto: UpsertSellerBusinessDto,
  ): Promise<
    SellerBusiness & {
      openingHours: Array<{ dayOfWeek: DayOfWeek; startTime: Date; endTime: Date }>;
    }
  > {
    const userId = await this.assertSeller(supabaseId);

    // Block business setup for fait-maison sellers — they're the only role
    // that skips this step.
    const profile = await this.prisma.db.sellerProfile.findUnique({
      where: { userId },
      select: { category: true },
    });
    if (profile?.category === SellerCategory.FAIT_MAISON) {
      throw new BadRequestException('Fait-maison sellers do not have a business profile');
    }

    // SIRET rule by category: only Sauve Ton Panier (RESTAURANT) must provide
    // one; Traiteur is optional (client decision). Fait-maison never reaches
    // here. When provided, it must still pass Luhn. Stored null when absent.
    const siret = dto.siret?.trim() ? dto.siret.trim() : null;
    if (profile?.category === SellerCategory.RESTAURANT && !siret) {
      throw new BadRequestException('Veuillez renseigner votre SIRET pour continuer.');
    }
    if (siret && !isValidSiret(siret)) {
      throw new BadRequestException('siret must pass Luhn validation');
    }

    // SellerBusiness upsert + opening hours replace in one transaction.
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.sellerBusiness.upsert({
        where: { userId },
        create: {
          userId,
          businessName: dto.businessName,
          siret,
          facadeUrl: dto.facadeUrl ?? null,
          legalForm: dto.legalForm ?? null,
        },
        update: {
          businessName: dto.businessName,
          siret,
          facadeUrl: dto.facadeUrl ?? null,
          legalForm: dto.legalForm ?? null,
        },
      });

      // Replace the opening-hours set.
      await tx.sellerOpeningHours.deleteMany({ where: { sellerId: userId } });
      if (dto.openingHours && dto.openingHours.length > 0) {
        await tx.sellerOpeningHours.createMany({
          data: dto.openingHours.map((hr) => ({
            sellerId: userId,
            dayOfWeek: hr.dayOfWeek,
            startTime: parseTimeOfDay(hr.startTime),
            endTime: parseTimeOfDay(hr.endTime),
          })),
        });
      }

      const openingHours = await tx.sellerOpeningHours.findMany({
        where: { sellerId: userId },
        orderBy: { dayOfWeek: 'asc' },
        select: { dayOfWeek: true, startTime: true, endTime: true },
      });
      return { ...business, openingHours };
    });
  }

  // -------------------- Cuisines / Dishes --------------------

  async upsertCuisines(
    supabaseId: string,
    dto: UpsertSellerCuisinesDto,
  ): Promise<{ cuisines: CuisineType[]; dishTypes: DishType[] }> {
    const userId = await this.assertSeller(supabaseId);

    // Dish types only apply to traiteur/restaurant. Fait-maison (or an unset
    // category, which defaults to fait-maison) has none — so an empty list is
    // fine there and any sent dish types are ignored. Traiteur/restaurant must
    // pick at least one.
    const profile = await this.prisma.db.sellerProfile.findUnique({
      where: { userId },
      select: { category: true },
    });
    const isFaitMaison =
      profile?.category == null || profile.category === SellerCategory.FAIT_MAISON;
    if (!isFaitMaison && dto.dishTypes.length === 0) {
      throw new BadRequestException('At least one dish type is required');
    }
    const dishTypes = isFaitMaison ? [] : dto.dishTypes;

    return this.prisma.$transaction(async (tx) => {
      await tx.sellerCuisine.deleteMany({ where: { userId } });
      await tx.sellerDish.deleteMany({ where: { userId } });
      await tx.sellerCuisine.createMany({
        data: dto.cuisines.map((cuisineType) => ({ userId, cuisineType })),
      });
      await tx.sellerDish.createMany({
        data: dishTypes.map((dishType) => ({ userId, dishType })),
      });
      return { cuisines: dto.cuisines, dishTypes };
    });
  }

  // -------------------- Internals --------------------

  /** Returns the User.id of a valid seller; 403 otherwise. */
  private async assertSeller(supabaseId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true, sellerProfile: { select: { userId: true } } },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role !== UserRole.Seller || !user.sellerProfile) {
      throw new ForbiddenException('Only sellers can update seller profile');
    }
    return user.id;
  }
}

function parseTimeOfDay(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(0);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

/** 14 digits passing Luhn. */
function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = Number(siret[i]);
    if ((13 - i) % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
