import { IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /v1/drivers/me/deliveries/:id/confirm-pickup`. The driver
 * scans the seller's pickup QR and submits the embedded token (proof the dish
 * was handed over), optionally with their current GPS position.
 */
export class ConfirmPickupDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  pickupToken!: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}
