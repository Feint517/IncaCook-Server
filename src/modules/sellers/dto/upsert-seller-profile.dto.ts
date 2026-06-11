import { SellerCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Body for `PUT /v1/sellers/me/profile`. Fills the seller-profile slice
 * shown on the "Profile" step of the wizard. Service-layer enforces the
 * "FAIT_MAISON sellers don't have a SellerBusiness" / "non-fait-maison
 * require one" coupling at a higher level (Phase C: GET /me/onboarding).
 *
 * The whole body is the desired state — sending the field as null clears
 * the optional ones (bio, prep window, etc.).
 */
export class UpsertSellerProfileDto {
  @IsEnum(SellerCategory)
  category!: SellerCategory;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  /** Storage object key in `avatars/` — uploaded via Phase D's signed URL flow. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  profilePhotoUrl!: string;

  /** ISO date YYYY-MM-DD. */
  @IsDateString()
  dateOfBirth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryRadiusKm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  deliveryFeeCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  prepMinMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  prepMaxMinutes?: number;

  /** Hygiene charter is accepted via POST /v1/users/me/charters; these
   *  booleans on the profile are a fast-path mirror for legacy reads. */
  @IsOptional()
  hygieneCommitment?: boolean;

  @IsOptional()
  faitMaisonCommitment?: boolean;
}
