# Error codes

All domain errors carry a stable code, prefixed with `INCACOOK_`, defined in [`src/common/constants/error-codes.constants.ts`](../src/common/constants/error-codes.constants.ts).

The mobile app should branch on `error.code`, never on `error.message`.

| Code | Status | Meaning |
|---|---|---|
| `INCACOOK_UNKNOWN` | 500 | Catch-all for unhandled exceptions |
| `INCACOOK_VALIDATION_FAILED` | 400 / 422 | Input failed schema validation |
| `INCACOOK_UNAUTHORIZED` | 401 | Missing or invalid JWT |
| `INCACOOK_FORBIDDEN` | 403 | Authenticated but not allowed |
| `INCACOOK_NOT_FOUND` | 404 | Resource not found |
| `INCACOOK_CONFLICT` | 409 | Unique constraint or version conflict |
| `INCACOOK_RATE_LIMITED` | 429 | Throttle hit |
| `INCACOOK_IDEMPOTENCY_CONFLICT` | 409 | Same key, different request body |
| `INCACOOK_INVALID_TOKEN` | 401 | JWT signature or audience invalid |
| `INCACOOK_EXPIRED_TOKEN` | 401 | JWT expired |
| `INCACOOK_LISTING_EXPIRED` | 422 | Listing window has closed |
| `INCACOOK_LISTING_UNAVAILABLE` | 422 | Soft-paused or moderated |
| `INCACOOK_INSUFFICIENT_STOCK` | 422 | Not enough quantity left |
| `INCACOOK_PRICE_CAP_EXCEEDED` | 422 | Le Bon Fait Maison price > €4.50 |
| `INCACOOK_ORDER_TRANSITION_INVALID` | 422 | State machine rejects transition |
| `INCACOOK_ORDER_ALREADY_CANCELLED` | 422 | Idempotent cancel of a cancelled order |
| `INCACOOK_PAYMENT_FAILED` | 402 | Stripe declined |
| `INCACOOK_INSUFFICIENT_FUNDS` | 422 | Wallet balance below threshold |
| `INCACOOK_WITHDRAWAL_BELOW_MINIMUM` | 422 | < `WITHDRAWAL_MINIMUM_EUROS` |
| `INCACOOK_SELLER_NOT_VERIFIED` | 403 | Seller has not finished onboarding |
| `INCACOOK_KYC_PENDING` | 403 | Stripe Connect KYC outstanding |
| `INCACOOK_NO_DRIVER_AVAILABLE` | 422 | No driver inside delivery radius |
| `INCACOOK_DRIVER_OFFLINE` | 422 | Assigned driver disconnected |

When adding a new code:

1. Add it to `ErrorCodes` in `error-codes.constants.ts`.
2. Document it here in alphabetical-by-domain order.
3. Throw it from a `DomainException` or `BusinessRuleException` subclass.
