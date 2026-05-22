import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { Allergen } from '@common/enums/allergen.enum';
import { CuisineType } from '@common/enums/cuisine-type.enum';
import { DietaryTag } from '@common/enums/dietary-tag.enum';
import { DishType } from '@common/enums/dish-type.enum';
import { Fulfillment } from '@common/enums/fulfillment.enum';

import { CreateListingAddOnDto } from './create-listing-add-on.dto';

/**
 * Body for `POST /v1/listings`. The seller is resolved from the JWT;
 * `category` is server-set from SellerProfile (not sent in the body).
 *
 * Service-layer validations on top of these structural ones:
 *   - imageUrls.length <= 3 (also enforced by DB CHECK)
 *   - originalPriceCents >= priceCents (also enforced by DB CHECK)
 *   - fait_maison sellers: priceCents <= 450, portionsLeft + expiresAt required
 *   - expiresAt > now() when supplied
 *
 * Wire field `extras` maps to the internal `ListingAddOn` Prisma model.
 */
export class CreateListingDto {
  @IsString() @MinLength(1) @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  // Storage object keys in `listings/`. App caps at 3.
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3)
  imageUrls!: string[];

  @IsInt() @Min(0)
  priceCents!: number;

  @IsOptional() @IsInt() @Min(0)
  originalPriceCents?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  discountPercent?: number;

  // null = "cook to order" (restaurant/traiteur). Required for fait_maison —
  // enforced server-side.
  @IsOptional() @IsInt() @Min(0)
  portionsLeft?: number;

  @IsOptional() @IsArray() @IsEnum(CuisineType, { each: true }) @ArrayUnique()
  cuisineTypes?: CuisineType[];

  @IsOptional() @IsArray() @IsEnum(DishType, { each: true }) @ArrayUnique()
  dishTypes?: DishType[];

  @IsOptional() @IsArray() @IsEnum(DietaryTag, { each: true }) @ArrayUnique()
  dietaryTags?: DietaryTag[];

  @IsOptional() @IsArray() @IsEnum(Allergen, { each: true }) @ArrayUnique()
  allergens?: Allergen[];

  @IsOptional() @IsString() @MaxLength(500)
  otherAllergens?: string;

  @IsOptional() @IsBoolean()
  isAvailable?: boolean;

  @IsOptional() @IsBoolean()
  isVeg?: boolean;

  @IsOptional() @IsString() @MaxLength(100)
  menuCategory?: string;

  @IsEnum(Fulfillment)
  fulfillment!: Fulfillment;

  @IsInt() @Min(0)
  prepMinutes!: number;

  // null = permanent menu item (restaurant/traiteur). Required for fait_maison —
  // enforced server-side.
  @IsOptional() @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateListingAddOnDto)
  extras?: CreateListingAddOnDto[];
}
