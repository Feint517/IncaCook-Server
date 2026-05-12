import { Type } from 'class-transformer';
import { IsBoolean, IsLatitude, IsLongitude, IsOptional } from 'class-validator';

/**
 * Body for `POST /v1/drivers/me/online`. Driver tells us they're going
 * online/offline; optionally piggy-backs a location update so we have a
 * recent point for matching (long-term real-time tracking goes via Redis
 * — see DriverProfile.lastKnownPoint in the schema).
 */
export class OnlineStatusDto {
  @IsBoolean()
  isOnline!: boolean;

  @IsOptional() @IsLatitude() @Type(() => Number)
  lat?: number;

  @IsOptional() @IsLongitude() @Type(() => Number)
  lng?: number;
}
