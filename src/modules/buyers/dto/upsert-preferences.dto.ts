import { ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { Allergen, DietaryTag } from '@prisma/client';

/**
 * Body for `PUT /v1/buyers/me/preferences`. Idempotent replace —
 * subsequent calls fully replace both arrays. Skippable: clients can send
 * empty arrays.
 */
export class UpsertBuyerPreferencesDto {
  @IsArray()
  @IsEnum(DietaryTag, { each: true })
  @ArrayUnique()
  dietaryTags!: DietaryTag[];

  @IsArray()
  @IsEnum(Allergen, { each: true })
  @ArrayUnique()
  allergens!: Allergen[];
}
