import { ReportStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for `PATCH /v1/admin/reports/:id/status`. */
export class UpdateReportStatusDto {
  /** Only RESOLVED | REJECTED are accepted (validated in the service). */
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;
}
