import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Listing, ListingAddOn } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { CreateListingAddOnDto } from './dto/create-listing-add-on.dto';
import { CreateListingDto } from './dto/create-listing.dto';
import { FeedSort, ListFeedQueryDto } from './dto/list-feed-query.dto';
import { UpdateListingDto } from './dto/update-listing.dto';

type ListingWithAddOns = Listing & { addOns: ListingAddOn[] };
type Tx = Prisma.TransactionClient;

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
  portionsLeft: number;
  cuisineType: string | null;
  dishType: string | null;
  dietaryTags: string[];
  allergens: string[];
  otherAllergens: string | null;
  isAvailable: boolean;
  isVeg: boolean;
  menuCategory: string | null;
  category: string;
  fulfillment: string;
  prepMinutes: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  sellerName: string;
  sellerRadiusKm: number;
  distanceKm: number | null;
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
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the JWT user to the seller's userId, or throws. */
  private async assertSeller(supabaseId: string): Promise<string> {
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
    return user.id;
  }

  async create(supabaseId: string, dto: CreateListingDto): Promise<ListingWithAddOns> {
    const sellerId = await this.assertSeller(supabaseId);

    const seller = await this.prisma.db.sellerProfile.findUnique({
      where: { userId: sellerId },
    });
    if (!seller) {
      throw new ForbiddenException('Only sellers can manage listings');
    }

    validateListingShape(dto);
    const expiresAt = parseFutureDate(dto.expiresAt, 'expiresAt');

    const id = generateUlid();
    return this.prisma.$transaction(async (tx) => {
      await tx.listing.create({
        data: {
          id,
          sellerId,
          // category is server-set from the seller's profile (denormalized).
          category: seller.category,
          name: dto.name,
          description: dto.description ?? null,
          imageUrls: dto.imageUrls,
          priceCents: dto.priceCents,
          originalPriceCents: dto.originalPriceCents ?? null,
          discountPercent: dto.discountPercent ?? null,
          portionsLeft: dto.portionsLeft,
          cuisineType: dto.cuisineType ?? null,
          dishType: dto.dishType ?? null,
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

      if (dto.addOns && dto.addOns.length > 0) {
        await this.replaceAddOns(tx, id, dto.addOns);
      }

      return this.loadWithAddOns(tx, id);
    });
  }

  async findById(id: string): Promise<ListingWithAddOns> {
    const listing = await this.prisma.db.listing.findUnique({
      where: { id },
      include: { addOns: true },
    });
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }
    return listing;
  }

  async findMine(supabaseId: string): Promise<ListingWithAddOns[]> {
    const sellerId = await this.assertSeller(supabaseId);
    return this.prisma.db.listing.findMany({
      where: { sellerId },
      include: { addOns: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    supabaseId: string,
    id: string,
    dto: UpdateListingDto,
  ): Promise<ListingWithAddOns> {
    const sellerId = await this.assertSeller(supabaseId);

    const existing = await this.prisma.db.listing.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Listing not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenException('Cannot edit another seller\'s listing');
    }

    // Cross-field validations apply to the merged shape (existing ⊕ dto).
    const merged = mergeForValidation(existing, dto);
    validateListingShape(merged);

    const data: Prisma.ListingUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.imageUrls !== undefined) data.imageUrls = dto.imageUrls;
    if (dto.priceCents !== undefined) data.priceCents = dto.priceCents;
    if (dto.originalPriceCents !== undefined) data.originalPriceCents = dto.originalPriceCents;
    if (dto.discountPercent !== undefined) data.discountPercent = dto.discountPercent;
    if (dto.portionsLeft !== undefined) data.portionsLeft = dto.portionsLeft;
    if (dto.cuisineType !== undefined) data.cuisineType = dto.cuisineType;
    if (dto.dishType !== undefined) data.dishType = dto.dishType;
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

      if (dto.addOns !== undefined) {
        // Replace-on-update: clear existing add-ons, insert the new set.
        await tx.listingAddOn.deleteMany({ where: { listingId: id } });
        if (dto.addOns.length > 0) {
          await this.replaceAddOns(tx, id, dto.addOns);
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
    const sellerId = await this.assertSeller(supabaseId);
    const existing = await this.prisma.db.listing.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Listing not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenException('Cannot edit another seller\'s listing');
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
        : query.sort ?? (buyerPoint ? FeedSort.Distance : FeedSort.Newest);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`l."deletedAt" IS NULL`,
      Prisma.sql`l."isAvailable" = true`,
      Prisma.sql`l."expiresAt" > now()`,
      Prisma.sql`sp."kycStatus" = 'APPROVED'::"KycStatus"`,
      Prisma.sql`u."deletedAt" IS NULL`,
    ];

    if (query.category) {
      conditions.push(Prisma.sql`l."category" = ${query.category}::"SellerCategory"`);
    }
    if (query.cuisineType) {
      conditions.push(Prisma.sql`l."cuisineType" = ${query.cuisineType}::"CuisineType"`);
    }
    if (query.dishType) {
      conditions.push(Prisma.sql`l."dishType" = ${query.dishType}::"DishType"`);
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
      conditions.push(
        Prisma.sql`NOT (l."allergens" && ${query.avoidAllergens}::"Allergen"[])`,
      );
    }
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(l."name" ILIKE ${pattern} OR l."description" ILIKE ${pattern})`,
      );
    }

    if (buyerPoint && query.maxDistanceKm !== undefined) {
      const meters = query.maxDistanceKm * 1000;
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
        l."cuisineType",
        l."dishType",
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
        sp."deliveryRadiusKm"::float8 AS "sellerRadiusKm",
        sp."averageRating" AS "rating",
        sp."reviewCount" AS "reviewCount",
        ${distanceSql} AS "distanceKm"
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

    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: { buyerProfile: { include: { defaultAddress: true } } },
    });
    const addressId = user?.buyerProfile?.defaultAddress?.id;
    if (!addressId) {
      return null;
    }

    const rows = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT
        ST_Y("point"::geometry)::float8 AS "lat",
        ST_X("point"::geometry)::float8 AS "lng"
      FROM "Address"
      WHERE id = ${addressId} AND "point" IS NOT NULL
    `;
    return rows[0] ?? null;
  }

  async softDelete(supabaseId: string, id: string): Promise<void> {
    const sellerId = await this.assertSeller(supabaseId);
    const existing = await this.prisma.db.listing.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Listing not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenException('Cannot delete another seller\'s listing');
    }
    await this.prisma.db.listing.update({
      where: { id },
      data: { deletedAt: new Date(), isAvailable: false },
    });
  }

  // ---------- helpers ----------

  private async replaceAddOns(
    tx: Tx,
    listingId: string,
    addOns: CreateListingAddOnDto[],
  ): Promise<void> {
    await tx.listingAddOn.createMany({
      data: addOns.map((addOn, idx) => ({
        id: generateUlid(),
        listingId,
        label: addOn.label,
        priceDeltaCents: addOn.priceDeltaCents,
        isSelectedByDefault: addOn.isSelectedByDefault ?? false,
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
}

function validateListingShape(s: ListingShape): void {
  if (s.imageUrls && s.imageUrls.length > 3) {
    throw new BadRequestException('imageUrls cannot have more than 3 entries');
  }
  if (
    s.originalPriceCents != null &&
    s.priceCents != null &&
    s.originalPriceCents < s.priceCents
  ) {
    throw new BadRequestException('originalPriceCents must be >= priceCents');
  }
}

function mergeForValidation(existing: Listing, dto: UpdateListingDto): ListingShape {
  return {
    imageUrls: dto.imageUrls ?? existing.imageUrls,
    priceCents: dto.priceCents ?? existing.priceCents,
    originalPriceCents:
      dto.originalPriceCents !== undefined ? dto.originalPriceCents : existing.originalPriceCents,
    discountPercent:
      dto.discountPercent !== undefined ? dto.discountPercent : existing.discountPercent,
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
