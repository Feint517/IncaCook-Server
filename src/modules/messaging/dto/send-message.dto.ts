import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /v1/orders/:orderId/messages`. A chat message
 * scoped to an order's thread (buyer ↔ seller). Sender + recipient
 * are resolved server-side from the order and the JWT.
 */
export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;
}
