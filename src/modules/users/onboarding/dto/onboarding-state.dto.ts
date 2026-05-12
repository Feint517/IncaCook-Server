import type { KycStatus } from '@prisma/client';

/**
 * Status values per the doc §4.2. `pending_review` is KYC-only —
 * everything else is just present (complete), absent (incomplete), or
 * explicitly not required for this user (skipped).
 */
export type StepStatus = 'complete' | 'incomplete' | 'skipped' | 'pending_review';

/**
 * Step keys per role. The Flutter wizard hardcodes the canonical order;
 * the backend just reports per-step status. The `next` field is the first
 * `incomplete` step in canonical order, or null when everything is done.
 */
export type BuyerStepKey = 'addresses' | 'preferences';

export type SellerStepKey =
  | 'profile'
  | 'addresses'
  | 'business'
  | 'cuisines'
  | 'kyc_id'
  | 'kyc_selfie'
  | 'charter';

export type DriverStepKey =
  | 'addresses'
  | 'vehicle'
  | 'zones'
  | 'kyc_id'
  | 'kyc_selfie'
  | 'documents'
  | 'charter';

export type AnyStepKey = BuyerStepKey | SellerStepKey | DriverStepKey;

export interface OnboardingStateDto {
  role: 'BUYER' | 'SELLER' | 'DRIVER';
  /** First incomplete step in canonical role-order, or null when done. */
  next: AnyStepKey | null;
  steps: Partial<Record<AnyStepKey, StepStatus>>;
  /** Aggregated review state from the user's KycDocument rows. Only
   *  surfaced for SELLER + DRIVER (buyer has no KYC). */
  kycReviewState?: KycStatus;
  /** Seller only: true when every step is complete/skipped AND
   *  kycReviewState=APPROVED. Listings publish gate reads this. */
  canList?: boolean;
  /** Driver only: analogous gate for delivery assignment. */
  canDeliver?: boolean;
}
