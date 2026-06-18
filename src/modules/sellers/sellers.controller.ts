import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { ListingResponseDto } from '@modules/listings/dto/listing-response.dto';
import { ListingsService } from '@modules/listings/listings.service';

import { SyncSubscriptionDto } from './dto/sync-subscription.dto';
import { UpsertSellerBusinessDto } from './dto/upsert-seller-business.dto';
import { UpsertSellerCuisinesDto } from './dto/upsert-seller-cuisines.dto';
import { UpsertSellerProfileDto } from './dto/upsert-seller-profile.dto';
import { SellersService } from './sellers.service';

import type { SellerSubscriptionResponseDto } from './dto/seller-subscription-response.dto';

@Controller({ path: 'sellers/me', version: '1' })
export class SellersController {
  constructor(
    private readonly sellers: SellersService,
    private readonly listings: ListingsService,
  ) {}

  @Put('profile')
  upsertProfile(@CurrentUser() jwtUser: AuthenticatedUser, @Body() dto: UpsertSellerProfileDto) {
    return this.sellers.upsertProfile(jwtUser.id, dto);
  }

  @Put('business')
  upsertBusiness(@CurrentUser() jwtUser: AuthenticatedUser, @Body() dto: UpsertSellerBusinessDto) {
    return this.sellers.upsertBusiness(jwtUser.id, dto);
  }

  @Put('cuisines')
  upsertCuisines(@CurrentUser() jwtUser: AuthenticatedUser, @Body() dto: UpsertSellerCuisinesDto) {
    return this.sellers.upsertCuisines(jwtUser.id, dto);
  }

  /**
   * Reconciles the seller's RevenueCat (App Store / Google Play) subscription
   * after a purchase or restore in the app. Authenticated — the seller is
   * resolved from the JWT, never the body. Returns the resulting state so the
   * onboarding screen can unlock "Terminer".
   */
  @Post('subscription/sync')
  @HttpCode(HttpStatus.OK)
  syncSubscription(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: SyncSubscriptionDto,
  ): Promise<SellerSubscriptionResponseDto> {
    return this.sellers.syncRevenueCatSubscription(jwtUser.id, dto);
  }

  /**
   * The seller's dashboard view of their own listings — includes any
   * `isAvailable = false` ones and historical expired entries, unlike the
   * buyer feed at `GET /v1/listings`. Soft-deleted rows are excluded.
   */
  @Get('listings')
  async myListings(@CurrentUser() jwtUser: AuthenticatedUser): Promise<ListingResponseDto[]> {
    const listings = await this.listings.findMine(jwtUser.id);
    return listings.map((l) => ListingResponseDto.from(l));
  }
}
