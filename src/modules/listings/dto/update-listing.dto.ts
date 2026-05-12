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
 * Body for `PATCH /v1/listings/:id`. All fields optional; only the supplied
 * fields are updated.
 *
 * `addOns` is a full-replacement field: if present, the listing's add-on
 * set is replaced with the supplied array (cascade-delete + insert in one
 * transaction). Omit it to leave add-ons unchanged.
 */
export class UpdateListingDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200)
  name?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(3)
  imageUrls?: string[];

  @IsOptional() @IsInt() @Min(0)
  priceCents?: number;

  @IsOptional() @IsInt() @Min(0)
  originalPriceCents?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  discountPercent?: number;

  @IsOptional() @IsInt() @Min(0)
  portionsLeft?: number;

  @IsOptional() @IsEnum(CuisineType)
  cuisineType?: CuisineType;

  @IsOptional() @IsEnum(DishType)
  dishType?: DishType;

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

  @IsOptional() @IsEnum(Fulfillment)
  fulfillment?: Fulfillment;

  @IsOptional() @IsInt() @Min(0)
  prepMinutes?: number;

  @IsOptional() @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateListingAddOnDto)
  addOns?: CreateListingAddOnDto[];
}
