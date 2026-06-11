import { ReportReason, ReportStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query params for `GET /v1/admin/reports`. All optional. */
export class ListReportsQueryDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  /** Filter by report type (the `reason` column). */
  @IsOptional()
  @IsEnum(ReportReason)
  type?: ReportReason;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number;
}
