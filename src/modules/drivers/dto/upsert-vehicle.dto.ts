import { DriverVehicleType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

/**
 * Body for `PUT /v1/drivers/me/vehicle`. Sets vehicleType and (optionally)
 * date of birth on the same call since the wizard collects both on the
 * "Vehicle / DOB" screen.
 */
export class UpsertDriverVehicleDto {
  @IsEnum(DriverVehicleType)
  vehicleType!: DriverVehicleType;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
