import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { Allergen } from '@common/enums/allergen.enum';
import { CuisineType } from '@common/enums/cuisine-type.enum';
import { DietaryTag } from '@common/enums/dietary-tag.enum';
import { DishType } from '@common/enums/dish-type.enum';
import { Fulfillment } from '@common/enums/fulfillment.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';

export enum FeedSort {
  Distance = 'distance',
  Newest = 'newest',
  PriceAsc = 'price_asc',
  PriceDesc = 'price_desc',
}

/**
 * Splits a comma-separated query value into a string array. `?dietary=HALAL,VEGAN`
 * arrives as the string "HALAL,VEGAN"; this normalises it. Already-array
 * values (e.g. when the same key is repeated) pass through.
 */
const splitCsv = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return value;
};

/** Query params for `GET /v1/listings`. All optional. */
export class ListFeedQueryDto {
  @IsOptional() @IsEnum(SellerCategory)
  category?: SellerCategory;

  /**
   * Listings whose `cuisineTypes` overlap ANY of these. CSV: `?cuisineTypes=ORIENTALE,ITALIENNE`.
   * Empty / absent → no filter on cuisine.
   */
  @IsOptional()
  @Transform(splitCsv)
  @IsArray() @IsEnum(CuisineType, { each: true }) @ArrayUnique()
  cuisineTypes?: CuisineType[];

  /**
   * Listings whose `dishTypes` overlap ANY of these. CSV: `?dishTypes=PLAT,DESSERT`.
   * Empty / absent → no filter on dish type.
   */
  @IsOptional()
  @Transform(splitCsv)
  @IsArray() @IsEnum(DishType, { each: true }) @ArrayUnique()
  dishTypes?: DishType[];

  @IsOptional() @IsEnum(Fulfillment)
  fulfillment?: Fulfillment;

  /**
   * Listings whose `dietaryTags` contain ALL of these. CSV: `?dietary=HALAL,VEGAN`.
   */
  @IsOptional()
  @Transform(splitCsv)
  @IsArray() @IsEnum(DietaryTag, { each: true }) @ArrayUnique()
  dietary?: DietaryTag[];

  /**
   * Listings that contain NONE of these allergens. CSV: `?avoidAllergens=GLUTEN,LAIT`.
   */
  @IsOptional()
  @Transform(splitCsv)
  @IsArray() @IsEnum(Allergen, { each: true }) @ArrayUnique()
  avoidAllergens?: Allergen[];

  @IsOptional() @IsBoolean()
  isVeg?: boolean;

  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  minPriceCents?: number;

  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  maxPriceCents?: number;

  /** Hard cap distance in km. Requires buyer location to be present. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(500) @Type(() => Number)
  maxDistanceKm?: number;

  /** ILIKE match on name + description. */
  @IsOptional() @IsString() @MaxLength(120)
  search?: string;

  /**
   * Buyer's current location. If absent, falls back to BuyerProfile's default
   * address point. If neither resolves, the response has `distanceKm: null`
   * and distance-based sort/filter is disabled.
   */
  @IsOptional() @IsLatitude() @Type(() => Number)
  lat?: number;

  @IsOptional() @IsLongitude() @Type(() => Number)
  lng?: number;

  @IsOptional() @IsEnum(FeedSort)
  sort?: FeedSort;

  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number)
  limit?: number;

  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  offset?: number;
}
