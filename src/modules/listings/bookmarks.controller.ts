import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { Allergen } from '@common/enums/allergen.enum';
import { CuisineType } from '@common/enums/cuisine-type.enum';
import { DietaryTag } from '@common/enums/dietary-tag.enum';
import { DishType } from '@common/enums/dish-type.enum';
import { Fulfillment } from '@common/enums/fulfillment.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';

import { BookmarksService } from './bookmarks.service';
import type { FeedRow } from './listings.service';
import { FeedListingResponseDto } from './dto/feed-listing-response.dto';
import { FeedResponseDto } from './dto/feed-response.dto';
import { ListFeedQueryDto } from './dto/list-feed-query.dto';

/**
 * Bookmarks split across two URL spaces:
 *   - `/v1/listings/:id/bookmark` for set/remove (the bookmark is a
 *     property of the listing as the user perceives it)
 *   - `/v1/me/bookmarks` for the buyer's library view
 *
 * Both share the same controller class — distinct @Controller paths
 * aren't possible per class, so we use method-level full paths.
 */
@Controller({ version: '1' })
export class BookmarksController {
  constructor(private readonly bookmarks: BookmarksService) {}

  /** Idempotent: duplicate POSTs are no-ops. */
  @Post('listings/:id/bookmark')
  @HttpCode(HttpStatus.NO_CONTENT)
  async add(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') listingId: string,
  ): Promise<void> {
    await this.bookmarks.add(jwtUser.id, listingId);
  }

  /** Idempotent: removing a non-existent bookmark is a no-op. */
  @Delete('listings/:id/bookmark')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') listingId: string,
  ): Promise<void> {
    await this.bookmarks.remove(jwtUser.id, listingId);
  }

  /**
   * The buyer's bookmarked listings, newest-bookmarked first. Same row
   * shape as the buyer feed (sans distance) so the Flutter app can reuse
   * its cell. Pagination only (limit/offset) — filtering/sorting belong
   * to the feed.
   */
  @Get('me/bookmarks')
  async list(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Query() query: ListFeedQueryDto,
  ): Promise<FeedResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const result = await this.bookmarks.listForBuyer(jwtUser.id, limit, offset);
    return {
      items: result.items.map((row) => toFeedListing(row)),
      limit,
      offset,
      hasMore: result.hasMore,
    };
  }
}

/**
 * Same mapping as ListingsController.toFeedListing, kept local so changes
 * here don't leak into the feed and vice versa. `inRange` is null for
 * bookmarks since we deliberately don't compute distance here.
 */
function toFeedListing(row: FeedRow): FeedListingResponseDto {
  return {
    id: row.id,
    sellerId: row.sellerId,
    name: row.name,
    description: row.description,
    imageUrls: row.imageUrls,
    priceCents: row.priceCents,
    originalPriceCents: row.originalPriceCents,
    discountPercent: row.discountPercent,
    portionsLeft: row.portionsLeft,
    cuisineTypes: row.cuisineTypes as CuisineType[],
    dishTypes: row.dishTypes as DishType[],
    dietaryTags: row.dietaryTags as DietaryTag[],
    allergens: row.allergens as Allergen[],
    otherAllergens: row.otherAllergens,
    isAvailable: row.isAvailable,
    isVeg: row.isVeg,
    menuCategory: row.menuCategory,
    category: row.category as SellerCategory,
    fulfillment: row.fulfillment as Fulfillment,
    prepMinutes: row.prepMinutes,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    extras: [],
    sellerName: row.sellerName,
    distanceKm: null,
    inRange: null,
    rating: row.rating,
    reviewCount: row.reviewCount,
  };
}
