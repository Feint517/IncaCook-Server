import type { BuyerProfile } from '@prisma/client';

import { Allergen } from '@common/enums/allergen.enum';
import { Dietary } from '@common/enums/dietary.enum';

import { AddressResponseDto } from './address-response.dto';

export class BuyerProfileResponseDto {
  defaultAddress!: AddressResponseDto | null;
  dietaryPreferences!: Dietary[];
  allergies!: Allergen[];

  static from(
    profile: BuyerProfile,
    defaultAddress: AddressResponseDto | null,
  ): BuyerProfileResponseDto {
    return {
      defaultAddress,
      dietaryPreferences: profile.dietaryPreferences as Dietary[],
      allergies: profile.allergies as Allergen[],
    };
  }
}
