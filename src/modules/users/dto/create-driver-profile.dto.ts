import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { DriverVehicleType } from '@common/enums/driver-vehicle-type.enum';

import { CreateAddressDto } from './create-address.dto';

/**
 * Sub-DTO carried inside `CreateUserDto` when role = DRIVER.
 *
 * Payouts are handled via Stripe Connect (separate slice). The driver
 * completes Stripe Express onboarding after signup; nothing payout-related
 * is collected here.
 *
 * Service-layer validations on top of these:
 *   - dateOfBirth: driver must be ≥ 18 on signup day
 *   - All three commitments must be true (charter/punctuality/care)
 */
export class CreateDriverProfileDto {
  // ISO date (YYYY-MM-DD).
  @IsDateString()
  dateOfBirth!: string;

  @ValidateNested()
  @Type(() => CreateAddressDto)
  baseAddress!: CreateAddressDto;

  @IsEnum(DriverVehicleType)
  vehicleType!: DriverVehicleType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  operatingZones!: string[];

  @IsBoolean()
  @Equals(true, { message: 'charterAccepted must be true' })
  charterAccepted!: boolean;

  @IsBoolean()
  @Equals(true, { message: 'punctualityCommitment must be true' })
  punctualityCommitment!: boolean;

  @IsBoolean()
  @Equals(true, { message: 'careCommitment must be true' })
  careCommitment!: boolean;
}
