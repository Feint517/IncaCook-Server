import { ConversationType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query for `GET /v1/conversations`. */
export class ListConversationsQueryDto {
  /** When omitted, returns every conversation the caller participates in.
   *  Pass to filter (e.g. seller screen passes `BUYER_SELLER`). */
  @IsOptional()
  @IsEnum(ConversationType)
  type?: ConversationType;

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
