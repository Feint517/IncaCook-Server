import { Body, Controller, Put } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { UpsertSellerBusinessDto } from './dto/upsert-seller-business.dto';
import { UpsertSellerCuisinesDto } from './dto/upsert-seller-cuisines.dto';
import { UpsertSellerProfileDto } from './dto/upsert-seller-profile.dto';
import { SellersService } from './sellers.service';

@Controller({ path: 'sellers/me', version: '1' })
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  @Put('profile')
  upsertProfile(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: UpsertSellerProfileDto,
  ) {
    return this.sellers.upsertProfile(jwtUser.id, dto);
  }

  @Put('business')
  upsertBusiness(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: UpsertSellerBusinessDto,
  ) {
    return this.sellers.upsertBusiness(jwtUser.id, dto);
  }

  @Put('cuisines')
  upsertCuisines(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: UpsertSellerCuisinesDto,
  ) {
    return this.sellers.upsertCuisines(jwtUser.id, dto);
  }
}
