import { ReportReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for `POST /v1/reports`. The reporter is resolved from the JWT.
 * Provide a target: `listingId` (a dish) or `sellerId` (a seller User.id).
 *
 *   { "type": "NON_FAIT_MAISON", "listingId": "...", "reason": "…" }
 *
 * Service rules: NON_FAIT_MAISON requires a FAIT_MAISON listing;
 * MAUVAISE_HYGIENE applies to any category.
 */
export class CreateReportDto {
  /** Report type — stored in `Report.reason`. */
  @IsEnum(ReportReason)
  type!: ReportReason;

  /** Target dish. Required for NON_FAIT_MAISON. */
  @IsOptional()
  @IsString()
  listingId?: string;

  /** Target seller (User.id) — when reporting the seller, not a specific dish. */
  @IsOptional()
  @IsString()
  sellerId?: string;

  /** Optional free-text comment — stored in `Report.description`. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
