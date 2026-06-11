import { SubscriptionStatus } from '@prisma/client';

/**
 * Single source of truth for "is this seller's subscription active?".
 * Active = status ACTIVE/TRIALING and (no period end recorded yet, or it's
 * still in the future). Shared by the subscription service, the listing /
 * order gates, and the webhook handler so the rule never drifts.
 */
export function isSubscriptionActive(
  status: SubscriptionStatus | null | undefined,
  currentPeriodEnd: Date | null | undefined,
): boolean {
  if (status !== SubscriptionStatus.ACTIVE && status !== SubscriptionStatus.TRIALING) {
    return false;
  }
  if (currentPeriodEnd && currentPeriodEnd.getTime() <= Date.now()) {
    return false;
  }
  return true;
}

/**
 * Maps a Stripe subscription `status` string to our `SubscriptionStatus`
 * enum. Unknown values fall back to INCOMPLETE (treated as inactive).
 */
export function subscriptionStatusFromStripe(raw: string): SubscriptionStatus {
  switch (raw) {
    case 'active':
      return SubscriptionStatus.ACTIVE;
    case 'trialing':
      return SubscriptionStatus.TRIALING;
    case 'past_due':
      return SubscriptionStatus.PAST_DUE;
    case 'canceled':
      return SubscriptionStatus.CANCELED;
    case 'unpaid':
      return SubscriptionStatus.UNPAID;
    case 'incomplete':
      return SubscriptionStatus.INCOMPLETE;
    case 'incomplete_expired':
      return SubscriptionStatus.INCOMPLETE_EXPIRED;
    default:
      return SubscriptionStatus.INCOMPLETE;
  }
}
