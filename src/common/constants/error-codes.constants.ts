/**
 * Domain error codes — prefixed with `INCACOOK_` for namespacing.
 * Documented in docs/error-codes.md.
 */
export const ErrorCodes = {
  // Generic
  Unknown: 'INCACOOK_UNKNOWN',
  ValidationFailed: 'INCACOOK_VALIDATION_FAILED',
  Unauthorized: 'INCACOOK_UNAUTHORIZED',
  Forbidden: 'INCACOOK_FORBIDDEN',
  NotFound: 'INCACOOK_NOT_FOUND',
  Conflict: 'INCACOOK_CONFLICT',
  RateLimited: 'INCACOOK_RATE_LIMITED',
  IdempotencyConflict: 'INCACOOK_IDEMPOTENCY_CONFLICT',

  // Auth
  InvalidToken: 'INCACOOK_INVALID_TOKEN',
  ExpiredToken: 'INCACOOK_EXPIRED_TOKEN',
  // OAuth identity has no email (e.g. Facebook returned none) and none has
  // been verified yet — the client must collect + verify one first.
  EmailRequired: 'INCACOOK_EMAIL_REQUIRED',
  // Phone number is already linked to a different account — blocks the OTP
  // request/resend before any SMS is sent.
  PhoneAlreadyUsed: 'INCACOOK_PHONE_ALREADY_USED',

  // Listings
  ListingExpired: 'INCACOOK_LISTING_EXPIRED',
  ListingUnavailable: 'INCACOOK_LISTING_UNAVAILABLE',
  InsufficientStock: 'INCACOOK_INSUFFICIENT_STOCK',
  PriceCapExceeded: 'INCACOOK_PRICE_CAP_EXCEEDED',

  // Orders
  OrderTransitionInvalid: 'INCACOOK_ORDER_TRANSITION_INVALID',
  OrderAlreadyCancelled: 'INCACOOK_ORDER_ALREADY_CANCELLED',

  // Payments
  PaymentFailed: 'INCACOOK_PAYMENT_FAILED',
  InsufficientFunds: 'INCACOOK_INSUFFICIENT_FUNDS',
  WithdrawalBelowMinimum: 'INCACOOK_WITHDRAWAL_BELOW_MINIMUM',

  // Sellers
  SellerNotVerified: 'INCACOOK_SELLER_NOT_VERIFIED',
  KycPending: 'INCACOOK_KYC_PENDING',

  // Drivers
  NoDriverAvailable: 'INCACOOK_NO_DRIVER_AVAILABLE',
  DriverOffline: 'INCACOOK_DRIVER_OFFLINE',
  // Seller/driver hasn't finished Stripe Connect payout onboarding — blocks
  // claiming deliveries (and, later, any payout-bearing action).
  PayoutOnboardingIncomplete: 'INCACOOK_PAYOUT_ONBOARDING_INCOMPLETE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
