import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Query for `GET /v1/conversations/:id/messages`. */
export class ListMessagesQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;

  /** Cursor = the oldest already-fetched message id; the server
   *  returns messages strictly older than that, in DESC order. */
  @IsOptional()
  @IsString()
  before?: string;
}
