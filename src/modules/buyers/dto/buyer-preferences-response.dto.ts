import type { Allergen, DietaryTag } from '@prisma/client';

export class BuyerPreferencesResponseDto {
  dietaryTags!: DietaryTag[];
  allergens!: Allergen[];
}
