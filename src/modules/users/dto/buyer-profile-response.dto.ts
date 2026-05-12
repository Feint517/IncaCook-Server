import type { BuyerProfile } from '@prisma/client';

import { Allergen } from '@common/enums/allergen.enum';
import { DietaryTag } from '@common/enums/dietary-tag.enum';

import { AddressResponseDto } from './address-response.dto';

export class BuyerProfileResponseDto {
  defaultAddress!: AddressResponseDto | null;
  dietaryPreferences!: DietaryTag[];
  allergies!: Allergen[];

  static from(
    profile: BuyerProfile,
    defaultAddress: AddressResponseDto | null,
  ): BuyerProfileResponseDto {
    return {
      defaultAddress,
      dietaryPreferences: profile.dietaryPreferences as DietaryTag[],
      allergies: profile.allergies as Allergen[],
    };
  }
}
