import { IsEnum, IsISO8601, IsOptional } from 'class-validator';

/**
 * Preset date windows for dashboard aggregations. `all` = no time bound.
 * `custom` is implied when `dateFrom`/`dateTo` are supplied (they take
 * precedence over `range`).
 */
export enum DashboardRange {
  Today = 'today',
  Last7Days = 'last7Days',
  Last30Days = 'last30Days',
  All = 'all',
  Custom = 'custom',
}

/** Shared query for the admin dashboard endpoints (date filtering). */
export class DashboardQueryDto {
  @IsOptional()
  @IsEnum(DashboardRange)
  range?: DashboardRange;

  /** ISO-8601. When set (with/without dateTo), overrides `range`. */
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}
