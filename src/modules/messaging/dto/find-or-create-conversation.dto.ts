import { ConversationType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/**
 * Body for `POST /v1/conversations`. The caller specifies the
 * **type** of conversation they want plus either the **counterpart**'s
 * user id (peerUserId) OR an `orderId` the server derives the peer
 * from. The server resolves the find-or-create uniqueness rules per
 * type:
 *
 *   - BUYER_SELLER  → unique by (buyer, seller) when `orderId` is
 *                     null; per-order when set (so order-specific
 *                     threads can fork off later).
 *   - BUYER_DELIVERY → unique by (orderId, buyer, delivery partner).
 *                      Requires `orderId` and an assigned driver.
 *   - SUPPORT       → unique by (user, support staff).
 *
 * `peerUserId` is optional: when omitted, the server derives the
 * counterpart from `orderId` + the caller's role on that order (buyer,
 * seller or assigned driver). This is what the buyer↔livreur chat
 * uses — neither party knows the other's user id, only the order, and
 * the call fails cleanly until a driver has been assigned.
 */
export class FindOrCreateConversationDto {
  @IsEnum(ConversationType)
  type!: ConversationType;

  @IsOptional()
  @IsString()
  peerUserId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  storeId?: string;
}
