import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `POST /v1/orders/:id/cancel`. The reason is buyer-facing. */
export class CancelOrderDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
