import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { Allergen } from '@common/enums/allergen.enum';
import { CuisineType } from '@common/enums/cuisine-type.enum';
import { DietaryTag } from '@common/enums/dietary-tag.enum';
import { DishType } from '@common/enums/dish-type.enum';
import { Fulfillment } from '@common/enums/fulfillment.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { CreateListingDto } from './dto/create-listing.dto';
import { FeedListingResponseDto } from './dto/feed-listing-response.dto';
import { FeedResponseDto } from './dto/feed-response.dto';
import { ListFeedQueryDto } from './dto/list-feed-query.dto';
import { ListingResponseDto } from './dto/listing-response.dto';
import { ToggleAvailabilityDto } from './dto/toggle-availability.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { ListingsService, type FeedRow } from './listings.service';

@Controller({ path: 'listings', version: '1' })
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: CreateListingDto,
  ): Promise<ListingResponseDto> {
    const listing = await this.listings.create(jwtUser.id, dto);
    return ListingResponseDto.from(listing);
  }

  /**
   * Buyer feed. Filtered, sorted, paginated. Visibility gate enforced
   * server-side: only listings from APPROVED, non-deleted sellers.
   */
  @Get()
  async feed(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Query() query: ListFeedQueryDto,
  ): Promise<FeedResponseDto> {
    const result = await this.listings.feed(jwtUser.id, query);
    return {
      items: result.items.map((row) => toFeedListing(row)),
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
    };
  }

  /**
   * Public details — buyer feed shares this endpoint. Sellers' own
   * dashboard list lives on `GET /v1/sellers/me/listings`.
   */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<ListingResponseDto> {
    const listing = await this.listings.findById(id);
    return ListingResponseDto.from(listing);
  }

  @Patch(':id')
  async update(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
  ): Promise<ListingResponseDto> {
    const listing = await this.listings.update(jwtUser.id, id, dto);
    return ListingResponseDto.from(listing);
  }

  /** Quick on/off toggle without sending the whole listing payload. */
  @Patch(':id/availability')
  async toggleAvailability(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ToggleAvailabilityDto,
  ): Promise<ListingResponseDto> {
    const listing = await this.listings.setAvailability(jwtUser.id, id, dto.isAvailable);
    return ListingResponseDto.from(listing);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.listings.softDelete(jwtUser.id, id);
  }
}

/**
 * Maps a FeedRow (raw SQL output) to FeedListingResponseDto. Computes
 * `inRange` from distanceKm and the seller's deliveryRadiusKm. Aggregates
 * we don't have yet (rating, reviewCount) ship as null/0.
 */
export function toFeedListing(row: FeedRow): FeedListingResponseDto {
  const distanceKm = row.distanceKm;
  const inRange = distanceKm === null ? null : distanceKm <= row.sellerRadiusKm;

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
    distanceKm,
    inRange,
    rating: row.rating,
    reviewCount: row.reviewCount,
  };
}
