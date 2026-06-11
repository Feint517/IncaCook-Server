import { Body, Controller, Get, Put } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { ListingResponseDto } from '@modules/listings/dto/listing-response.dto';
import { ListingsService } from '@modules/listings/listings.service';

import { UpsertSellerBusinessDto } from './dto/upsert-seller-business.dto';
import { UpsertSellerCuisinesDto } from './dto/upsert-seller-cuisines.dto';
import { UpsertSellerProfileDto } from './dto/upsert-seller-profile.dto';
import { SellersService } from './sellers.service';

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
