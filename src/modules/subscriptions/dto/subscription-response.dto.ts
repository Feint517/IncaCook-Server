import { SubscriptionStatus } from '@prisma/client';

/** `GET /v1/sellers/me/subscription` — the seller's current state. */
export class SubscriptionResponseDto {
  status!: SubscriptionStatus;
  /** End of the current paid period (renewal date), ISO 8601 or null. */
  currentPeriodEnd!: string | null;
  /** Derived gate the app uses to unlock seller features. */
  active!: boolean;
}

/** `{ url }` for the Billing Portal redirect. */
export class SubscriptionUrlResponseDto {
  url!: string;
}

/**
 * `POST /v1/sellers/me/subscription` — in-app subscribe. Returns the first
 * invoice's PaymentIntent client secret so the app can confirm the card
 * with `flutter_stripe` (same as the buyer checkout). `clientSecret` is
 * null when no payment is required (e.g. already active / 100% off).
 */
export class SubscriptionIntentResponseDto {
  clientSecret!: string | null;
  subscriptionId!: string;
  /** Raw Stripe subscription status at creation (usually `incomplete`). */
  status!: string;
}
