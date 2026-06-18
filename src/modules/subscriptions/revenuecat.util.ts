import { SellerCategory, SubscriptionStatus } from '@prisma/client';

/**
 * RevenueCat ↔ IncaCook subscription mapping. Shared by the seller sync
 * endpoint and the RevenueCat webhook so the rules never drift.
 *
 * The seller monthly plan maps onto the EXISTING gate fields
 * (`subscriptionStatus`, `subscriptionCurrentPeriodEnd`, `isPremium`) that the
 * listing gate (`isSubscriptionActive`) and the commission tier already read —
 * RevenueCat just becomes another writer of those fields.
 */

export const SELLER_STANDARD_ENTITLEMENT = 'seller_standard';
export const SELLER_PREMIUM_ENTITLEMENT = 'seller_premium';

/** "seller_premium" → "PREMIUM", "seller_standard" → "STANDARD". */
export function entitlementToPlan(entitlement: string | null | undefined): string | null {
  if (entitlement === SELLER_PREMIUM_ENTITLEMENT) return 'PREMIUM';
  if (entitlement === SELLER_STANDARD_ENTITLEMENT) return 'STANDARD';
  return null;
}

export function isPremiumEntitlement(entitlement: string | null | undefined): boolean {
  return entitlement === SELLER_PREMIUM_ENTITLEMENT;
}

/** Premium wins over standard when both are somehow present. */
export function pickActiveEntitlement(entitlementIds: readonly string[]): string | null {
  if (entitlementIds.includes(SELLER_PREMIUM_ENTITLEMENT)) return SELLER_PREMIUM_ENTITLEMENT;
  if (entitlementIds.includes(SELLER_STANDARD_ENTITLEMENT)) return SELLER_STANDARD_ENTITLEMENT;
  return null;
}

/** RevenueCat `period_type` (TRIAL/INTRO/NORMAL) → ACTIVE vs TRIALING. */
export function activeStatusForPeriod(periodType: string | null | undefined): SubscriptionStatus {
  const p = (periodType ?? '').toUpperCase();
  return p === 'TRIAL' || p === 'INTRO' ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE;
}

/**
 * Maps a RevenueCat webhook event type to our status. Returns null for events
 * that shouldn't change subscription state (TEST, TRANSFER, etc.).
 */
export function webhookEventToStatus(
  type: string,
  periodType: string | null | undefined,
): SubscriptionStatus | null {
  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
    case 'SUBSCRIPTION_EXTENDED':
    case 'NON_RENEWING_PURCHASE':
      return activeStatusForPeriod(periodType);
    case 'CANCELLATION':
      // Per spec: cancellation ⇒ CANCELED. (RevenueCat still grants access
      // until EXPIRATION; we keep `subscriptionCurrentPeriodEnd` so a future
      // refinement could honour the remaining paid period.)
      return SubscriptionStatus.CANCELED;
    case 'EXPIRATION':
      return SubscriptionStatus.EXPIRED;
    case 'BILLING_ISSUE':
      return SubscriptionStatus.PAST_DUE;
    default:
      return null;
  }
}

export interface SubscriptionUpdateInput {
  status: SubscriptionStatus;
  entitlement: string | null;
  productId: string | null;
  expiresAtMs: number | null;
  isTrial: boolean;
  category: SellerCategory | null;
  revenueCatCustomerId: string | null;
}

/** Same day next month (used as the safe "+1 month" subscription fallback). */
export function oneMonthFromNow(from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() + 1);
  return d;
}

/**
 * The exact `SellerProfile` field set to write for a subscription change.
 * Centralised so the sync endpoint and webhook produce identical rows. The
 * `as const` Prisma `data` object is returned so callers just spread it.
 */
export function buildSubscriptionFields(input: SubscriptionUpdateInput) {
  const active =
    input.status === SubscriptionStatus.ACTIVE || input.status === SubscriptionStatus.TRIALING;
  // Never leave the period end null after activation: RevenueCat omits the
  // expiry in sandbox / test mode, and a null end would make the gate treat
  // the seller as "active forever" with no renewal date on the dashboard.
  // A safe +1-month fallback anchors the date-based gate; the webhook/REST
  // verify overwrite it with the real renewal date when available.
  const periodEnd = input.expiresAtMs
    ? new Date(input.expiresAtMs)
    : active
      ? oneMonthFromNow()
      : null;
  return {
    subscriptionStatus: input.status,
    isPremium: active && isPremiumEntitlement(input.entitlement),
    revenueCatEntitlement: input.entitlement,
    subscriptionPlan: entitlementToPlan(input.entitlement),
    subscriptionProductId: input.productId,
    subscriptionCurrentPeriodEnd: periodEnd,
    trialEndsAt: input.isTrial ? periodEnd : null,
    ...(input.category ? { subscriptionCategory: input.category } : {}),
    ...(input.revenueCatCustomerId ? { revenueCatCustomerId: input.revenueCatCustomerId } : {}),
  };
}
