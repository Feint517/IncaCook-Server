import { IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /v1/drivers/me/deliveries/:id/confirm-delivery`. The driver
 * scans the buyer's reception QR and submits the embedded token (proof the
 * order reached the client), optionally with their current GPS position.
 */
export class ConfirmDeliveryDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deliveryToken!: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;
}
