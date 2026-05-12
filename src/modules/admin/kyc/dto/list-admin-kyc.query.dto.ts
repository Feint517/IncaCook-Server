import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { KycStatus } from '@common/enums/kyc-status.enum';

/**
 * Query params for `GET /v1/admin/kyc-submissions`. Defaults to PENDING
 * (the review queue) sorted oldest-first (FIFO).
 */
export class ListAdminKycQueryDto {
  @IsOptional() @IsEnum(KycStatus)
  status?: KycStatus;

  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number)
  limit?: number;

  @IsOptional() @IsInt() @Min(0) @Type(() => Number)
  offset?: number;
}
