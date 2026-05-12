import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SavedAddressType } from '@prisma/client';

/**
 * Body for `PUT /v1/users/me/addresses/:kind`. The path's `:kind`
 * parameter (one of buyer-delivery / seller-pickup / driver-home) decides
 * which AddressKind enum value is set on the row. Only one row exists per
 * (user, kind) for SELLER_PICKUP / DRIVER_HOME (partial unique idx);
 * BUYER_DELIVERY allows multiple but the wizard's "default address" step
 * targets a singleton — Phase B treats it as upsert-singleton everywhere.
 */
export class UpsertAddressDto {
  @IsString() @MinLength(1) @MaxLength(500)
  fullAddress!: string;

  @IsString() @MinLength(1) @MaxLength(120)
  city!: string;

  @IsString() @MinLength(1) @MaxLength(20)
  postalCode!: string;

  @IsOptional()
  @IsEnum(SavedAddressType)
  type?: SavedAddressType;

  @IsOptional() @IsString() @MaxLength(80)
  customLabel?: string;

  @IsOptional() @IsString() @MaxLength(50)
  apartment?: string;

  @IsOptional() @IsString() @MaxLength(10)
  floor?: string;

  @IsOptional() @IsString() @MaxLength(20)
  digicode?: string;

  @IsOptional() @IsString() @MaxLength(500)
  deliveryNotes?: string;

  @IsOptional() @IsNumber() @IsLatitude() @Type(() => Number)
  lat?: number;

  @IsOptional() @IsNumber() @IsLongitude() @Type(() => Number)
  lng?: number;
}
