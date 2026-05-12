import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { IdDocumentType } from '@common/enums/id-document-type.enum';

/**
 * Body for `POST /v1/kyc-submissions`. The Flutter app uploads each file to
 * Supabase Storage (bucket: `kyc/`, path `kyc/<supabase_user_id>/...`) and
 * sends the storage object key here.
 *
 * Conditional requirements (service-layer validated):
 *   - idDocumentType ∈ {CARTE_IDENTITE, TITRE_SEJOUR} → idBackUrl required
 *   - idDocumentType = PASSEPORT                     → idBackUrl must be absent
 *   - drivingLicenseUrl / carteGriseUrl / insuranceUrl: drivers w/ motorized
 *     vehicles only. Sellers must omit these.
 */
export class CreateKycSubmissionDto {
  @IsEnum(IdDocumentType)
  idDocumentType!: IdDocumentType;

  @IsString() @MinLength(1) @MaxLength(500)
  idFrontUrl!: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(500)
  idBackUrl?: string;

  @IsString() @MinLength(1) @MaxLength(500)
  selfieUrl!: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(500)
  drivingLicenseUrl?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(500)
  carteGriseUrl?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(500)
  insuranceUrl?: string;
}
