import type { Listing, ListingAddOn } from '@prisma/client';

import { Allergen } from '@common/enums/allergen.enum';
import { CuisineType } from '@common/enums/cuisine-type.enum';
import { DietaryTag } from '@common/enums/dietary-tag.enum';
import { DishType } from '@common/enums/dish-type.enum';
import { Fulfillment } from '@common/enums/fulfillment.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';

/** Single extras row in the listing detail response. Internal model: `ListingAddOn`. */
export class ListingExtraResponseDto {
  id!: string;
  label!: string;
  priceDeltaCents!: number;
  isSelectedByDefault!: boolean;
  sortOrder!: number;

  static from(addOn: ListingAddOn): ListingExtraResponseDto {
    return {
      id: addOn.id,
      label: addOn.label,
      priceDeltaCents: addOn.priceDeltaCents,
      isSelectedByDefault: addOn.isSelectedByDefault,
      sortOrder: addOn.sortOrder,
    };
  }
}

export class ListingResponseDto {
  id!: string;
  sellerId!: string;
  name!: string;
  description!: string | null;
  imageUrls!: string[];

  priceCents!: number;
  originalPriceCents!: number | null;
  discountPercent!: number | null;

  // null = "cook to order" (restaurant/traiteur); the buyer UI shows
  // "Disponible" instead of an N-portions count.
  portionsLeft!: number | null;

  cuisineTypes!: CuisineType[];
  dishTypes!: DishType[];
  dietaryTags!: DietaryTag[];
  allergens!: Allergen[];
  otherAllergens!: string | null;

  isAvailable!: boolean;
  isVeg!: boolean;
  menuCategory!: string | null;
  category!: SellerCategory;

  fulfillment!: Fulfillment;
  prepMinutes!: number;

  // null = permanent menu item (restaurant/traiteur).
  expiresAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;

  extras!: ListingExtraResponseDto[];

  static from(listing: Listing & { addOns: ListingAddOn[] }): ListingResponseDto {
    return {
      id: listing.id,
      sellerId: listing.sellerId,
      name: listing.name,
      description: listing.description,
      imageUrls: listing.imageUrls,
      priceCents: listing.priceCents,
      originalPriceCents: listing.originalPriceCents,
      discountPercent: listing.discountPercent,
      portionsLeft: listing.portionsLeft,
      cuisineTypes: listing.cuisineTypes as CuisineType[],
      dishTypes: listing.dishTypes as DishType[],
      dietaryTags: listing.dietaryTags as DietaryTag[],
      allergens: listing.allergens as Allergen[],
      otherAllergens: listing.otherAllergens,
      isAvailable: listing.isAvailable,
      isVeg: listing.isVeg,
      menuCategory: listing.menuCategory,
      category: listing.category as SellerCategory,
      fulfillment: listing.fulfillment as Fulfillment,
      prepMinutes: listing.prepMinutes,
      expiresAt: listing.expiresAt,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
      extras: listing.addOns
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((a) => ListingExtraResponseDto.from(a)),
    };
  }
}
