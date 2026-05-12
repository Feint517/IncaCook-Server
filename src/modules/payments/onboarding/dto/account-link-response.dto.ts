/**
 * Response from `POST /v1/stripe/onboarding/account-link`. The Flutter app
 * opens `url` in the system browser (or universal link), the user completes
 * onboarding on Stripe's hosted pages, then Stripe redirects back to the
 * configured return/refresh URL.
 *
 * `expiresAt` is a Unix timestamp (seconds) — Account Links expire ~5
 * minutes after creation. The app must request a fresh link if the user
 * doesn't open it in time.
 */
export class AccountLinkResponseDto {
  url!: string;
  expiresAt!: number;
}
