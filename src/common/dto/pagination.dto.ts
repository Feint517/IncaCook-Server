import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { BusinessRules } from '@common/constants/business-rules.constants';

export class CursorPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BusinessRules.MaxPageSize)
  limit: number = BusinessRules.DefaultPageSize;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class OffsetPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BusinessRules.MaxPageSize)
  limit: number = BusinessRules.DefaultPageSize;
}
