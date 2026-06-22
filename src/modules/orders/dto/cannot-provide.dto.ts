import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for `POST /v1/sellers/me/orders/:orderId/cannot-provide`. */
export class CannotProvideDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
