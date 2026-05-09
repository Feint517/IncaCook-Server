import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { SavedAddressType } from '@common/enums/saved-address-type.enum';

/**
 * Input shape for an address. Lat/lng are optional — when omitted the
 * `point` column stays NULL and a geocoding job can backfill it later.
 */
export class CreateAddressDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullAddress!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  postalCode!: string;

  @IsOptional()
  @IsEnum(SavedAddressType)
  type?: SavedAddressType;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  apartment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  digicode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryNotes?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;
}
