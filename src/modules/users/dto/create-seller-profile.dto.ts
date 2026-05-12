import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CuisineType } from '@common/enums/cuisine-type.enum';
import { DishType } from '@common/enums/dish-type.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';

import { CreateAddressDto } from './create-address.dto';
import { CreateOpeningHoursDto } from './create-opening-hours.dto';

/**
 * Sub-DTO carried inside `CreateUserDto` when role = SELLER.
 *
 * Conditional requirements (service-layer validated, not by class-validator):
 *   - category != FAIT_MAISON  → businessName + siret required
 *   - category = RESTAURANT    → restaurantFacadeUrl + openingHours required
 *   - category != RESTAURANT   → openingHours must be empty/absent
 *   - prepMaxMinutes >= prepMinMinutes
 *
 * `deliveryRadiusKm` accepts a number; class-transformer keeps it numeric.
 */
export class CreateSellerProfileDto {
  @IsEnum(SellerCategory)
  category!: SellerCategory;

  @IsString() @MinLength(1) @MaxLength(120)
  displayName!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  bio?: string;

  // Storage object key in `avatars/`. Client uploads to Supabase Storage
  // first, then sends the path here.
  @IsString() @MinLength(1)
  profilePhotoUrl!: string;

  // ISO date (YYYY-MM-DD). Service strips time on insert (date column).
  @IsDateString()
  dateOfBirth!: string;

  @ValidateNested() @Type(() => CreateAddressDto)
  pickupAddress!: CreateAddressDto;

  @IsOptional() @IsString() @MaxLength(200)
  businessName?: string;

  // 14-digit. Luhn validation done at the service layer.
  @IsOptional() @IsString() @MaxLength(14)
  siret?: string;

  @IsOptional() @IsString() @MinLength(1)
  restaurantFacadeUrl?: string;

  @IsArray() @IsEnum(CuisineType, { each: true }) @ArrayUnique()
  cuisineTypes!: CuisineType[];

  @IsArray() @IsEnum(DishType, { each: true }) @ArrayUnique()
  dishTypes!: DishType[];

  @IsBoolean()
  hygieneCommitment!: boolean;

  @IsBoolean()
  faitMaisonCommitment!: boolean;

  // numeric(4,1) — at most one decimal place; matches DB column.
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0) @Max(999.9)
  deliveryRadiusKm!: number;

  @IsInt() @Min(0)
  deliveryFeeCents!: number;

  @IsInt() @Min(0)
  prepMinMinutes!: number;

  @IsInt() @Min(0)
  prepMaxMinutes!: number;

  @IsString() @MinLength(1) @MaxLength(200)
  neighborhood!: string;

  @IsArray() @IsString({ each: true }) @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique()
  languageCodes!: string[];

  @IsOptional() @IsString() @MaxLength(500)
  availabilitySchedule?: string;

  @IsOptional() @IsString() @MaxLength(200)
  promoText?: string;

  @IsOptional() @IsString() @MaxLength(100)
  categoryTag?: string;

  // Empty array (or absent) for non-RESTAURANT categories. Required + non-empty
  // for RESTAURANT. Service-layer enforces.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOpeningHoursDto)
  openingHours?: CreateOpeningHoursDto[];
}
