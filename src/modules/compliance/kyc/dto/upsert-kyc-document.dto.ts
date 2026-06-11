import { KycDocType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { IdDocumentType } from '@common/enums/id-document-type.enum';

/**
 * Body for `POST /v1/kyc/documents`. Upserts one KycDocument row keyed on
 * (userId, type) — uploading a new file for the same slot supersedes the
 * previous one and resets review to PENDING.
 *
 * The file itself is uploaded to Supabase Storage in `kyc/<supabase_user_id>/`
 * (Phase A: by the Flutter app directly; Phase D: via a backend-issued
 * pre-signed URL). This endpoint just records the resulting storage key.
 *
 * `idDocumentType` is only meaningful when `type ∈ {ID_FRONT, ID_BACK}`;
 * it's stashed in metadata so admin tooling knows what kind of ID is being
 * reviewed (carte d'identité / passeport / titre de séjour).
 */
export class UpsertKycDocumentDto {
  @IsEnum(KycDocType)
  type!: KycDocType;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  fileUrl!: string;

  @IsOptional()
  @IsEnum(IdDocumentType)
  idDocumentType?: IdDocumentType;
}
