import { IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export type SellerUnavailableReason = 'SELLER_ABSENT' | 'FOOD_NOT_AVAILABLE';

/**
 * Body for `POST /v1/drivers/me/deliveries/:id/report-seller-unavailable`. The
 * driver arrived but the seller couldn't provide the order. GPS presence is
 * mandatory (enforced in the service for the exact French message); a note +
 * photo are optional extra proof.
 */
export class ReportSellerUnavailableDto {
  @IsIn(['SELLER_ABSENT', 'FOOD_NOT_AVAILABLE'])
  reason!: SellerUnavailableReason;

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;
}
