import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database/prisma.service';

import type { FeedRow } from './listings.service';

@Injectable()
export class BookmarksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bookmarks a listing. Idempotent — duplicate calls are no-ops thanks
   * to the composite PK (buyerId, listingId).
   */
  async add(supabaseId: string, listingId: string): Promise<void> {
    const buyerId = await this.resolveBuyerId(supabaseId);

    const listing = await this.prisma.db.listing.findUnique({
      where: { id: listingId },
      select: { id: true },
    });
    if (!listing) {
      throw new NotFoundException('Listing not found');
    }

    await this.prisma.db.bookmark.upsert({
      where: { buyerId_listingId: { buyerId, listingId } },
      create: { buyerId, listingId },
      update: {}, // idempotent
    });
  }

  /** Removes a bookmark. Idempotent — no error if it didn't exist. */
  async remove(supabaseId: string, listingId: string): Promise<void> {
    const buyerId = await this.resolveBuyerId(supabaseId);
    await this.prisma.db.bookmark.deleteMany({
      where: { buyerId, listingId },
    });
  }

  /**
   * Lists the buyer's bookmarked listings. Returns the same FeedRow shape
   * the buyer feed uses, so the Flutter app can reuse its feed cell. The
   * query joins SellerProfile + User (visibility gate) and excludes:
   *   - bookmarks pointing at soft-deleted listings
   *   - bookmarks pointing at sellers who are PENDING/REJECTED
   *
   * `distanceKm` is omitted (returned as null) — bookmarks are a personal
   * library, not a feed; resolving lat/lng per call adds noise without
   * clear UX value. The Flutter app can re-fetch the feed if it needs
   * fresh distance.
   */
  async listForBuyer(
    supabaseId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: FeedRow[]; hasMore: boolean }> {
    const buyerId = await this.resolveBuyerId(supabaseId);
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
        NULL::float8 AS "distanceKm"
      FROM "Bookmark" b
      JOIN "Listing" l ON l.id = b."listingId"
      JOIN "SellerProfile" sp ON sp."userId" = l."sellerId"
      JOIN "User" u ON u.id = sp."userId"
      WHERE b."buyerId" = ${buyerId}
        AND l."deletedAt" IS NULL
        AND sp."kycStatus" = 'APPROVED'::"KycStatus"
        AND u."deletedAt" IS NULL
      ORDER BY b."createdAt" DESC
      LIMIT ${fetchSize}
      OFFSET ${offset}
    `;

    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  private async resolveBuyerId(supabaseId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    return user.id;
  }
}
