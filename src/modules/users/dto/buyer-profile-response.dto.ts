import { Allergen } from '@common/enums/allergen.enum';
import { DietaryTag } from '@common/enums/dietary-tag.enum';

import { AddressResponseDto } from './address-response.dto';

import type { BuyerProfile } from '@prisma/client';

/**
 * Buyer slice of /v1/users/me. Field names match the request body of
 * `PUT /v1/buyers/me/preferences` (dietaryTags / allergens) — the schema's
 * older column names (dietaryPreferences / allergies) are an internal
 * implementation detail and aren't exposed on the wire.
 */
export class BuyerProfileResponseDto {
  defaultAddress!: AddressResponseDto | null;
  dietaryTags!: DietaryTag[];
  allergens!: Allergen[];

  static from(
    profile: BuyerProfile,
    defaultAddress: AddressResponseDto | null,
  ): BuyerProfileResponseDto {
    return {
      defaultAddress,
      dietaryTags: profile.dietaryPreferences as DietaryTag[],
      allergens: profile.allergies as Allergen[],
    };
  }
}
