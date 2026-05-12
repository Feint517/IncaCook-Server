import { Body, Controller, Put } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { BuyersService } from './buyers.service';
import { BuyerPreferencesResponseDto } from './dto/buyer-preferences-response.dto';
import { UpsertBuyerPreferencesDto } from './dto/upsert-preferences.dto';

@Controller({ path: 'buyers/me', version: '1' })
export class BuyersController {
  constructor(private readonly buyers: BuyersService) {}

  @Put('preferences')
  upsertPreferences(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: UpsertBuyerPreferencesDto,
  ): Promise<BuyerPreferencesResponseDto> {
    return this.buyers.upsertPreferences(jwtUser.id, dto);
  }
}
