import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST /v1/drivers/me/deliveries/:id/confirm-absent-dropoff`. The
 * client was absent, so the driver leaves the order at the door with a
 * mandatory photo + GPS (server stamps the timestamp). An optional note can
 * record context (e.g. "déposé devant la porte").
 */
export class ConfirmAbsentDropoffDto {
  // Presence is enforced in the service so the exact French business errors
  // ("Photo obligatoire…", "Position GPS obligatoire") are returned rather than
  // a generic validation 400.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
