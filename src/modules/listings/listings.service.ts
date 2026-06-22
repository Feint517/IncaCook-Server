import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AddressKind, DishType, KycStatus, Prisma, SellerCategory } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { maxRadiusForCategory } from '@common/constants/seller-radius.constants';
import { UserRole } from '@common/enums/user-role.enum';
import { BusinessRuleException } from '@common/exceptions/business-rule.exception';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { recordTermsAcceptance } from '@modules/compliance/charters/record-terms-acceptance.util';
import { isSubscriptionActive } from '@modules/subscriptions/subscription.util';

import { CreateListingAddOnDto } from './dto/create-listing-add-on.dto';
import { CreateListingDto } from './dto/create-listing.dto';
import { FeedSort, ListFeedQueryDto } from './dto/list-feed-query.dto';
import { UpdateListingDto } from './dto/update-listing.dto';

import type { Listing, ListingAddOn, SellerProfile } from '@prisma/client';

type ListingWithAddOns = Listing & { addOns: ListingAddOn[] };
type Tx = Prisma.TransactionClient;

/**
 * Fait-maison price cap in cents (€4.50). Kept in sync with the Flutter
 * client's `faitMaisonPriceCap` constant — see docs/posting-module.md §2.2.
 */
const FAIT_MAISON_PRICE_CAP_CENTS = 450;

/**
 * Which `DishType` values are valid for each seller category. Mirrors the
 * Flutter `DishType.valuesFor(category)` source of truth — see
 * docs/posting-module.md §2.6.c.
 *
 * fait_maison: empty — fait-maison sellers don't classify dishes by type.
 * restaurant : entrée, plat, dessert, boisson.
 * traiteur   : same as restaurant + cocktail dînatoire.
 */
const DISH_TYPES_BY_CATEGORY: Record<SellerCategory, ReadonlySet<DishType>> = {
  [SellerCategory.FAIT_MAISON]: new Set(),
  [SellerCategory.RESTAURANT]: new Set([
    DishType.ENTREE,
    DishType.PLAT,
    DishType.DESSERT,
    DishType.BOISSON,
  ]),
  [SellerCategory.TRAITEUR]: new Set([
    DishType.ENTREE,
    DishType.PLAT,
    DishType.DESSERT,
    DishType.BOISSON,
    DishType.COCKTAIL_DINATOIRE,
  ]),
};

/** Raw row shape returned by the feed SQL. Mirrors Listing + denormalized
 *  fields. Quoted camelCase aliases keep Postgres from lower-casing them. */
export interface FeedRow {
  id: string;
  sellerId: string;
  name: string;
  description: string | null;
  imageUrls: string[];
  priceCents: number;
  originalPriceCents: number | null;
  discountPercent: number | null;
  portionsLeft: number | null;
  cuisineTypes: string[];
  dishTypes: string[];
  dietaryTags: string[];
  allergens: string[];
  otherAllergens: string | null;
  isAvailable: boolean;
  isVeg: boolean;
  menuCategory: string | null;
  category: string;
  fulfillment: string;
  prepMinutes: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sellerName: string;
  sellerAvatarUrl: string | null;
  sellerRadiusKm: number;
  distanceKm: number | null;
  /** Seller pickup point (ST_Y/ST_X of SellerProfile.location). Null when the
   *  seller has no geocoded location. Used for buyer map pins. */
  sellerLat?: number | null;
  sellerLng?: number | null;
  /** Cached on SellerProfile.averageRating; null when the seller has no reviews yet. */
  rating: number | null;
  /** Cached on SellerProfile.reviewCount. */
  reviewCount: number;
}

export interface FeedResult {
  items: FeedRow[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the JWT user to the seller's userId.
   * `requireKycApproved` adds a 403 KYC_NOT_APPROVED gate for mutations
   * (POST/PATCH) — DELETE and availability toggles can run for any status.
   */
  private async assertSeller(
    supabaseId: string,
    opts: {
      requireKycApproved?: boolean;
      requireActiveSubscription?: boolean;
    } = {},
  ): Promise<{ sellerId: string; profile: SellerProfile; isSuspended: boolean }> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: { sellerProfile: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role !== UserRole.Seller || !user.sellerProfile) {
      throw new ForbiddenException('Only sellers can manage listings');
    }
    if (opts.requireKycApproved && user.sellerProfile.kycStatus !== KycStatus.APPROVED) {
      throw new ForbiddenException('KYC_NOT_APPROVED');
    }
    // Mandatory platform subscription gate — blocks add / edit / publish
    // when the seller's monthly subscription isn't active (date/status based).
    if (opts.requireActiveSubscription) {
      const active = isSubscriptionActive(
        user.sellerProfile.subscriptionStatus,
        user.sellerProfile.subscriptionCurrentPeriodEnd,
      );
      this.logger.log(
        `[SubscriptionGate] seller=${user.id} ` +
          `status=${user.sellerProfile.subscriptionStatus} ` +
          `expiresAt=${user.sellerProfile.subscriptionCurrentPeriodEnd?.toISOString() ?? 'null'} ` +
          `active=${active}`,
      );
      if (!active) {
        throw new ForbiddenException('SUBSCRIPTION_INACTIVE');
      }
    }
    return { sellerId: user.id, profile: user.sellerProfile, isSuspended: user.isSuspended };
  }

  async create(supabaseId: string, dto: CreateListingDto): Promise<ListingWithAddOns> {
    const {
      sellerId,
      profile: seller,
      isSuspended,
    } = await this.assertSeller(supabaseId, {
      requireKycApproved: true,
      requireActiveSubscription: true,
    });
    // Suspended sellers cannot publish new listings.
    if (isSuspended) {
      throw new ForbiddenException('Votre compte vendeur est suspendu.');
    }
    if (!seller.category) {
      throw new ForbiddenException('Complete your seller profile before creating listings');
    }

    // CGU/CGV must be explicitly accepted at each publication (client spec).
    if (dto.termsAccepted !== true) {
      throw new BadRequestException('Vous devez accepter les CGU/CGV avant de publier.');
    }

    const category = seller.category;
    validateListingShape({
      imageUrls: dto.imageUrls,
      priceCents: dto.priceCents,
      originalPriceCents: dto.originalPriceCents,
      discountPercent: dto.discountPercent,
      category,
    });
    validateCategoryShape(
      {
        priceCents: dto.priceCents,
        portionsLeft: dto.portionsLeft,
        expiresAt: dto.expiresAt,
        dishTypes: dto.dishTypes,
      },
      category,
    );
    validateAllergens(dto.allergens, dto.otherAllergens, dto.declaresNoAllergens);

    const expiresAt =
      dto.expiresAt !== undefined ? parseFutureDate(dto.expiresAt, 'expiresAt') : null;

    const id = generateUlid();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.listing.create({
        data: {
          id,
          sellerId,
          // category is server-set from the seller's profile (denormalized).
          category,
          name: dto.name,
          description: dto.description ?? null,
          imageUrls: dto.imageUrls,
          priceCents: dto.priceCents,
          originalPriceCents: dto.originalPriceCents ?? null,
          discountPercent: dto.discountPercent ?? null,
          portionsLeft: dto.portionsLeft ?? null,
          cuisineTypes: dto.cuisineTypes ?? [],
          dishTypes: dto.dishTypes ?? [],
          dietaryTags: dto.dietaryTags ?? [],
          allergens: dto.allergens ?? [],
          otherAllergens: dto.otherAllergens ?? null,
          isAvailable: dto.isAvailable ?? true,
          isVeg: dto.isVeg ?? false,
          menuCategory: dto.menuCategory ?? null,
          fulfillment: dto.fulfillment,
          prepMinutes: dto.prepMinutes,
          expiresAt,
        },
      });

      if (dto.extras && dto.extras.length > 0) {
        await this.replaceExtras(tx, id, dto.extras);
      }

      return this.loadWithAddOns(tx, id);
    });

    // Durable consent record (best-effort; never blocks a successful publish).
    await recordTermsAcceptance(this.prisma, sellerId);
    return created;
  }

  async findById(id: string): Promise<ListingWithAddOns & { seller: SellerProfile }> {
    const listing = await this.prisma.db.listing.findUnique({
      where: { id },
      // Load the seller relation so the detail response can carry the real
      // seller name + avatar (the buyer product-detail screen renders them).
      include: { addOns: true, seller: true },
    });
    if (!listing || listing.deletedAt !== null) {
      throw new NotFoundException('Listing not found');
    }
    // Hide listings of a suspended seller from buyers (cached/deep-linked detail).
    const sellerUser = await this.prisma.db.user.findUnique({
      where: { id: listing.sellerId },
      select: { isSuspended: true },
    });
    if (sellerUser?.isSuspended) {
      this.logger.warn(`[Strikes] hidden suspended seller listing sellerId=${listing.sellerId}`);
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  async findMine(supabaseId: string): Promise<ListingWithAddOns[]> {
    const { sellerId } = await this.assertSeller(supabaseId);
    return this.prisma.db.listing.findMany({
      where: { sellerId, deletedAt: null },
      include: { addOns: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(supabaseId: string, id: string, dto: UpdateListingDto): Promise<ListingWithAddOns> {
    const { sellerId } = await this.assertSeller(supabaseId, {
      requireKycApproved: true,
      requireActiveSubscription: true,
    });

    const existing = await this.prisma.db.listing.findUnique({ where: { id } });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException('Listing not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenException("Cannot edit another seller's listing");
    }

    // Cross-field validations apply to the merged shape (existing ⊕ dto).
    const merged = mergeForValidation(existing, dto);
    validateListingShape(merged);
    validateCategoryShape(
      {
        priceCents: merged.priceCents,
        portionsLeft: merged.portionsLeft,
        // `expiresAt` here is the merged Date|null; the helper accepts both.
        expiresAt: merged.expiresAt,
        dishTypes: merged.dishTypes,
      },
      existing.category,
    );
    // Re-validate the merged allergen declaration so an update can't strip it
    // below the publication floor.
    validateAllergens(
      dto.allergens ?? existing.allergens,
      dto.otherAllergens ?? existing.otherAllergens,
      dto.declaresNoAllergens,
    );

    const data: Prisma.ListingUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.imageUrls !== undefined) data.imageUrls = dto.imageUrls;
    if (dto.priceCents !== undefined) data.priceCents = dto.priceCents;
    if (dto.originalPriceCents !== undefined) data.originalPriceCents = dto.originalPriceCents;
    if (dto.discountPercent !== undefined) data.discountPercent = dto.discountPercent;
    if (dto.portionsLeft !== undefined) data.portionsLeft = dto.portionsLeft;
    if (dto.cuisineTypes !== undefined) data.cuisineTypes = dto.cuisineTypes;
    if (dto.dishTypes !== undefined) data.dishTypes = dto.dishTypes;
    if (dto.dietaryTags !== undefined) data.dietaryTags = dto.dietaryTags;
    if (dto.allergens !== undefined) data.allergens = dto.allergens;
    if (dto.otherAllergens !== undefined) data.otherAllergens = dto.otherAllergens ?? null;
    if (dto.isAvailable !== undefined) data.isAvailable = dto.isAvailable;
    if (dto.isVeg !== undefined) data.isVeg = dto.isVeg;
    if (dto.menuCategory !== undefined) data.menuCategory = dto.menuCategory ?? null;
    if (dto.fulfillment !== undefined) data.fulfillment = dto.fulfillment;
    if (dto.prepMinutes !== undefined) data.prepMinutes = dto.prepMinutes;
    if (dto.expiresAt !== undefined) {
      data.expiresAt = parseFutureDate(dto.expiresAt, 'expiresAt');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.listing.update({ where: { id }, data });

      if (dto.extras !== undefined) {
        // Replace-on-update: clear existing extras, insert the new set.
        await tx.listingAddOn.deleteMany({ where: { listingId: id } });
        if (dto.extras.length > 0) {
          await this.replaceExtras(tx, id, dto.extras);
        }
      }

      return this.loadWithAddOns(tx, id);
    });
  }

  async setAvailability(
    supabaseId: string,
    id: string,
    isAvailable: boolean,
  ): Promise<ListingWithAddOns> {
    // Publishing / unpublishing is a seller feature — gate on subscription.
    const { sellerId } = await this.assertSeller(supabaseId, {
      requireActiveSubscription: true,
    });
    const existing = await this.prisma.db.listing.findUnique({ where: { id } });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException('Listing not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenException("Cannot edit another seller's listing");
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.listing.update({ where: { id }, data: { isAvailable } });
      return this.loadWithAddOns(tx, id);
    });
  }

  /**
   * Buyer feed. Joins SellerProfile + User, applies the visibility gate
   * (kycStatus = APPROVED, user not deleted, listing live), filters per
   * query params, sorts, paginates with hasMore via fetch+1.
   *
   * Visibility: `expiresAt IS NULL OR expiresAt > now()` — restaurant /
   * traiteur listings with no expiry are permanent menu items.
   *
   * Distance: PostGIS ST_Distance / 1000 from the buyer point. Buyer point
   * comes from query lat/lng if present, otherwise the buyer's saved
   * default address. With no buyer point, distance-based sort/filter are
   * disabled and `distanceKm` is null in the response.
   */
  async feed(supabaseId: string, query: ListFeedQueryDto): Promise<FeedResult> {
    if ((query.lat !== undefined) !== (query.lng !== undefined)) {
      throw new BadRequestException('lat and lng must both be provided or both omitted');
    }

    const buyerPoint = await this.resolveBuyerPoint(supabaseId, query);
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    if (!buyerPoint && query.maxDistanceKm !== undefined) {
      throw new BadRequestException(
        'maxDistanceKm requires buyer location (lat/lng query params or a saved default address)',
      );
    }

    // Default sort: distance when buyer point known, else newest.
    // Requested distance with no point silently falls back to newest.
    const sort: FeedSort =
      query.sort === FeedSort.Distance && !buyerPoint
        ? FeedSort.Newest
        : (query.sort ?? (buyerPoint ? FeedSort.Distance : FeedSort.Newest));

    const conditions: Prisma.Sql[] = [
      Prisma.sql`l."deletedAt" IS NULL`,
      Prisma.sql`l."isAvailable" = true`,
      Prisma.sql`(l."expiresAt" IS NULL OR l."expiresAt" > now())`,
      Prisma.sql`sp."kycStatus" = 'APPROVED'::"KycStatus"`,
      // Only sellers with an active platform subscription appear in the feed.
      Prisma.sql`sp."subscriptionStatus"::text IN ('ACTIVE', 'TRIALING')`,
      Prisma.sql`(sp."subscriptionCurrentPeriodEnd" IS NULL OR sp."subscriptionCurrentPeriodEnd" > now())`,
      Prisma.sql`u."deletedAt" IS NULL`,
      // Suspended sellers are hidden from the buyer feed.
      Prisma.sql`u."isSuspended" = false`,
    ];

    if (query.category) {
      conditions.push(Prisma.sql`l."category" = ${query.category}::"SellerCategory"`);
    }
    if (query.cuisineTypes && query.cuisineTypes.length > 0) {
      // Array overlap — listing matches if ANY of its cuisines is in the query set.
      conditions.push(Prisma.sql`l."cuisineTypes" && ${query.cuisineTypes}::"CuisineType"[]`);
    }
    if (query.dishTypes && query.dishTypes.length > 0) {
      conditions.push(Prisma.sql`l."dishTypes" && ${query.dishTypes}::"DishType"[]`);
    }
    if (query.fulfillment) {
      conditions.push(Prisma.sql`l."fulfillment" = ${query.fulfillment}::"Fulfillment"`);
    }
    if (query.isVeg !== undefined) {
      conditions.push(Prisma.sql`l."isVeg" = ${query.isVeg}`);
    }
    if (query.minPriceCents !== undefined) {
      conditions.push(Prisma.sql`l."priceCents" >= ${query.minPriceCents}`);
    }
    if (query.maxPriceCents !== undefined) {
      conditions.push(Prisma.sql`l."priceCents" <= ${query.maxPriceCents}`);
    }
    if (query.dietary && query.dietary.length > 0) {
      // Listing must contain ALL requested dietary tags (intersection-as-superset).
      conditions.push(Prisma.sql`l."dietaryTags" @> ${query.dietary}::"DietaryTag"[]`);
    }
    if (query.avoidAllergens && query.avoidAllergens.length > 0) {
      // Exclude listings that share any allergen with the avoid set.
      conditions.push(Prisma.sql`NOT (l."allergens" && ${query.avoidAllergens}::"Allergen"[])`);
    }
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(Prisma.sql`(l."name" ILIKE ${pattern} OR l."description" ILIKE ${pattern})`);
    }
    if (query.inStockOnly) {
      // Sold-out = portionsLeft 0. null portionsLeft (cook-to-order) is in stock.
      conditions.push(Prisma.sql`(l."portionsLeft" IS NULL OR l."portionsLeft" > 0)`);
    }

    if (buyerPoint && query.maxDistanceKm !== undefined) {
      // Backend is the source of truth for the category radius cap — the
      // Flutter slider already clamps, but the API must protect against
      // misuse. Clamp silently (better search UX than a 400) and log it.
      // Cap: Traiteur 50 km; fait-maison / restaurant 10 km; no category 10.
      const cap = maxRadiusForCategory(query.category);
      const effectiveKm = Math.min(query.maxDistanceKm, cap);
      if (effectiveKm < query.maxDistanceKm) {
        this.logger.debug(
          `[feed] maxDistanceKm ${query.maxDistanceKm} clamped to ${effectiveKm} km ` +
            `(category=${query.category ?? 'ANY'})`,
        );
      }
      const meters = effectiveKm * 1000;
      conditions.push(Prisma.sql`
        ST_DWithin(
          sp."location",
          ST_SetSRID(ST_MakePoint(${buyerPoint.lng}, ${buyerPoint.lat}), 4326)::geography,
          ${meters}
        )
      `);
    }

    const whereSql = Prisma.join(conditions, ' AND ');

    const distanceSql = buyerPoint
      ? Prisma.sql`ST_Distance(
          sp."location",
          ST_SetSRID(ST_MakePoint(${buyerPoint.lng}, ${buyerPoint.lat}), 4326)::geography
        ) / 1000.0`
      : Prisma.sql`NULL::float8`;

    let orderBySql: Prisma.Sql;
    switch (sort) {
      case FeedSort.Distance:
        orderBySql = Prisma.sql`"distanceKm" ASC NULLS LAST, l."createdAt" DESC`;
        break;
      case FeedSort.PriceAsc:
        orderBySql = Prisma.sql`l."priceCents" ASC, l."createdAt" DESC`;
        break;
      case FeedSort.PriceDesc:
        orderBySql = Prisma.sql`l."priceCents" DESC, l."createdAt" DESC`;
        break;
      case FeedSort.Newest:
      default:
        orderBySql = Prisma.sql`l."createdAt" DESC`;
    }

    const fetchSize = limit + 1;

    const rows = await this.prisma.$queryRaw<FeedRow[]>`
      SELECT
        l.id,
        l."sellerId",
        l."name",
        l."description",
        l."imageUrls",
        l."priceCents",
        l."originalPriceCents",
        l."discountPercent",
        l."portionsLeft",
        l."cuisineTypes",
        l."dishTypes",
        l."dietaryTags",
        l."allergens",
        l."otherAllergens",
        l."isAvailable",
        l."isVeg",
        l."menuCategory",
        l."category",
        l."fulfillment",
        l."prepMinutes",
        l."expiresAt",
        l."createdAt",
        l."updatedAt",
        sp."displayName" AS "sellerName",
        sp."profilePhotoUrl" AS "sellerAvatarUrl",
        sp."deliveryRadiusKm"::float8 AS "sellerRadiusKm",
        sp."averageRating" AS "rating",
        sp."reviewCount" AS "reviewCount",
        ${distanceSql} AS "distanceKm",
        ST_Y(sp."location"::geometry)::float8 AS "sellerLat",
        ST_X(sp."location"::geometry)::float8 AS "sellerLng"
      FROM "Listing" l
      JOIN "SellerProfile" sp ON sp."userId" = l."sellerId"
      JOIN "User" u ON u.id = sp."userId"
      WHERE ${whereSql}
      ORDER BY ${orderBySql}
      LIMIT ${fetchSize}
      OFFSET ${offset}
    `;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, limit, offset, hasMore };
  }

  /**
   * Resolves the buyer's location for distance computation.
   * Priority: query lat/lng → BuyerProfile.defaultAddress.point → null.
   */
  private async resolveBuyerPoint(
    supabaseId: string,
    query: ListFeedQueryDto,
  ): Promise<{ lat: number; lng: number } | null> {
    if (query.lat !== undefined && query.lng !== undefined) {
      return { lat: query.lat, lng: query.lng };
    }

    const user = await this.prisma.db.user.findUnique({ where: { supabaseId } });
    if (!user) {
      return null;
    }
    // Buyer's default delivery address is now an Address row with
    // kind=BUYER_DELIVERY. Multiple may exist; most-recently-updated wins.
    const address = await this.prisma.db.address.findFirst({
      where: { userId: user.id, kind: AddressKind.BUYER_DELIVERY, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!address) {
      return null;
    }

    const rows = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT
        ST_Y("point"::geometry)::float8 AS "lat",
        ST_X("point"::geometry)::float8 AS "lng"
      FROM "Address"
      WHERE id = ${address.id} AND "point" IS NOT NULL
    `;
    return rows[0] ?? null;
  }

  async softDelete(supabaseId: string, id: string): Promise<void> {
    const { sellerId } = await this.assertSeller(supabaseId);
    const existing = await this.prisma.db.listing.findUnique({ where: { id } });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException('Listing not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenException("Cannot delete another seller's listing");
    }
    await this.prisma.db.listing.update({
      where: { id },
      data: { deletedAt: new Date(), isAvailable: false },
    });
  }

  // ---------- helpers ----------

  private async replaceExtras(
    tx: Tx,
    listingId: string,
    extras: CreateListingAddOnDto[],
  ): Promise<void> {
    await tx.listingAddOn.createMany({
      data: extras.map((extra, idx) => ({
        id: generateUlid(),
        listingId,
        label: extra.label,
        priceDeltaCents: extra.priceDeltaCents,
        isSelectedByDefault: extra.isSelectedByDefault ?? false,
        sortOrder: idx,
      })),
    });
  }

  private async loadWithAddOns(tx: Tx, id: string): Promise<ListingWithAddOns> {
    const listing = await tx.listing.findUnique({
      where: { id },
      include: { addOns: true },
    });
    if (!listing) {
      // Should never happen — the row was just inserted/updated in this tx.
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers (cross-field; class-validator handles per-field shape)
// ---------------------------------------------------------------------------

interface ListingShape {
  imageUrls?: string[];
  priceCents?: number;
  originalPriceCents?: number | null;
  discountPercent?: number | null;
  category?: SellerCategory;
}

function validateListingShape(s: ListingShape): void {
  if (s.imageUrls && s.imageUrls.length > 4) {
    throw new BadRequestException('imageUrls cannot have more than 4 entries');
  }
  if (s.originalPriceCents != null && s.priceCents != null && s.originalPriceCents < s.priceCents) {
    throw new BadRequestException('originalPriceCents must be >= priceCents');
  }
}

/**
 * Category-conditional rules (docs/posting-module.md §2.2, §2.6.a, §2.6.c):
 *   - fait_maison: priceCents <= 450; portionsLeft + expiresAt required; no dishTypes.
 *   - restaurant / traiteur: portionsLeft + expiresAt optional.
 *   - dishTypes values must be in DISH_TYPES_BY_CATEGORY[category].
 */
function validateCategoryShape(
  s: {
    priceCents?: number;
    portionsLeft?: number | null;
    expiresAt?: string | Date | null;
    dishTypes?: DishType[];
  },
  category: SellerCategory,
): void {
  if (category === SellerCategory.FAIT_MAISON) {
    if (s.priceCents !== undefined && s.priceCents > FAIT_MAISON_PRICE_CAP_CENTS) {
      throw new BusinessRuleException(
        ErrorCodes.PriceCapExceeded,
        `Fait-maison listings are capped at ${(FAIT_MAISON_PRICE_CAP_CENTS / 100).toFixed(2)}€`,
      );
    }
    if (s.portionsLeft === undefined || s.portionsLeft === null) {
      throw new BadRequestException('fait_maison listings require portionsLeft');
    }
    if (s.expiresAt === undefined || s.expiresAt === null) {
      throw new BadRequestException('fait_maison listings require expiresAt');
    }
  }

  if (s.dishTypes && s.dishTypes.length > 0) {
    const allowed = DISH_TYPES_BY_CATEGORY[category];
    const invalid = s.dishTypes.filter((dt) => !allowed.has(dt));
    if (invalid.length > 0) {
      const allowedList = Array.from(allowed);
      throw new BadRequestException(
        `dishTypes ${JSON.stringify(invalid)} not allowed for ${category}` +
          (allowedList.length === 0
            ? ' (no dish types are allowed for this category)'
            : ` — allowed: ${JSON.stringify(allowedList)}`),
      );
    }
  }
}

/**
 * Allergen declaration is mandatory at publication (food-safety / legal).
 * A valid declaration is one of:
 *   - at least one of the 14 EU allergens, OR
 *   - an "Autres" free-text entry (otherAllergens, non-blank), OR
 *   - an explicit "Aucun" (declaresNoAllergens) with no other allergen set.
 */
function validateAllergens(
  allergens: readonly string[] | undefined,
  otherAllergens: string | null | undefined,
  declaresNone: boolean | undefined,
): void {
  const hasReal = (allergens?.length ?? 0) > 0;
  const hasOther = typeof otherAllergens === 'string' && otherAllergens.trim().length > 0;

  if (declaresNone) {
    if (hasReal || hasOther) {
      throw new BadRequestException('"Aucun" ne peut pas être combiné avec d\'autres allergènes');
    }
    return;
  }
  if (!hasReal && !hasOther) {
    throw new BadRequestException(
      'Déclarez au moins un allergène, "Autres" (avec précision), ou "Aucun"',
    );
  }
}

function mergeForValidation(
  existing: Listing,
  dto: UpdateListingDto,
): ListingShape & {
  portionsLeft?: number | null;
  expiresAt?: Date | null;
  dishTypes?: DishType[];
} {
  return {
    imageUrls: dto.imageUrls ?? existing.imageUrls,
    priceCents: dto.priceCents ?? existing.priceCents,
    originalPriceCents:
      dto.originalPriceCents !== undefined ? dto.originalPriceCents : existing.originalPriceCents,
    discountPercent:
      dto.discountPercent !== undefined ? dto.discountPercent : existing.discountPercent,
    portionsLeft: dto.portionsLeft !== undefined ? dto.portionsLeft : existing.portionsLeft,
    expiresAt:
      dto.expiresAt !== undefined
        ? parseFutureDate(dto.expiresAt, 'expiresAt')
        : existing.expiresAt,
    dishTypes: dto.dishTypes !== undefined ? dto.dishTypes : (existing.dishTypes as DishType[]),
    category: existing.category,
  };
}

function parseFutureDate(iso: string, field: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date`);
  }
  if (d.getTime() <= Date.now()) {
    throw new BadRequestException(`${field} must be in the future`);
  }
  return d;
}
