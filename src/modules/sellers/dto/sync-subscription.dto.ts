import { SellerCategory } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Body for `POST /v1/sellers/me/subscription/sync`. Sent by the Flutter app
 * after a RevenueCat purchase/restore. These are HINTS for an optimistic UI
 * update — when `REVENUECAT_SECRET_API_KEY` is configured the backend ignores
 * them and verifies the subscriber against RevenueCat directly; the webhook is
 * the ongoing source of truth either way.
 */
export class SyncSubscriptionDto {
  /** Active entitlement id reported by the client (seller_standard|seller_premium). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entitlementId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  productId?: string;

  /** Entitlement expiration, epoch ms. */
  @IsOptional()
  @IsInt()
  @Min(0)
  expiresAtMs?: number;

  @IsOptional()
  @IsBoolean()
  isTrial?: boolean;

  /** RevenueCat app_user_id the SDK logged in with (should equal our User.id). */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  revenueCatCustomerId?: string;

  /** The seller category the plan was purchased for (optional, informational). */
  @IsOptional()
  @IsEnum(SellerCategory)
  category?: SellerCategory;
}
