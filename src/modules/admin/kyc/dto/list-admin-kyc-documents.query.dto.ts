import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { KycDocType } from '@prisma/client';

import { KycStatus } from '@common/enums/kyc-status.enum';

/**
 * Query params for `GET /v1/admin/kyc/documents`. Defaults to PENDING (the
 * review queue) sorted oldest-first (FIFO). Filter by `type` to focus on
 * one slot (e.g. ID_FRONT only).
 */
export class ListAdminKycDocumentsQueryDto {
  @IsOptional() @IsEnum(KycStatus)
  reviewState?: KycStatus;

  @IsOptional() @IsEnum(KycDocType)
  type?: KycDocType;

  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number)
  limit?: number;

  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  offset?: number;
}
