import { SubscriptionStatus } from '@prisma/client';

import { isSubscriptionActive } from '@modules/subscriptions/subscription.util';

import type { SellerProfile } from '@prisma/client';

/**
 * What the Flutter subscription screen reads back to unlock "Terminer".
 * `active` is the single gate the app trusts (status ∈ {ACTIVE,TRIALING} and
 * not past the current period end) — same rule the listing gate uses.
 */
export interface SellerSubscriptionResponseDto {
  status: SubscriptionStatus;
  active: boolean;
  isPremium: boolean;
  plan: string | null;
  entitlement: string | null;
  productId: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
}

export function toSellerSubscriptionResponse(
  profile: SellerProfile,
): SellerSubscriptionResponseDto {
  return {
    status: profile.subscriptionStatus,
    active: isSubscriptionActive(profile.subscriptionStatus, profile.subscriptionCurrentPeriodEnd),
    isPremium: profile.isPremium,
    plan: profile.subscriptionPlan ?? null,
    entitlement: profile.revenueCatEntitlement ?? null,
    productId: profile.subscriptionProductId ?? null,
    currentPeriodEnd: profile.subscriptionCurrentPeriodEnd?.toISOString() ?? null,
    trialEndsAt: profile.trialEndsAt?.toISOString() ?? null,
  };
}
