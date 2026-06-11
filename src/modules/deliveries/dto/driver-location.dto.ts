import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Body for `POST /v1/drivers/me/location`. The driver app pushes a fresh
 * fix every few seconds while a delivery is active. We update
 * DriverProfile.lastKnownPoint and, if there's an active delivery,
 * publish to Redis for realtime fanout to the buyer's tracking socket.
 */
export class DriverLocationDto {
  @IsLatitude()
  @Type(() => Number)
  lat!: number;

  @IsLongitude()
  @Type(() => Number)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  @Type(() => Number)
  headingDeg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  speedMps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  accuracyM?: number;
}
