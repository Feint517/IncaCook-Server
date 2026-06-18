import { registerAs } from '@nestjs/config';

/**
 * RevenueCat server-side config. Used ONLY for the seller monthly
 * subscription (App Store / Google Play). Stripe stays the source of truth
 * for payouts, wallet and order payments.
 *
 *  - `secretApiKey` (sk_…): optional. When set, the sync endpoint verifies the
 *    subscriber against RevenueCat's REST API instead of trusting the client.
 *  - `webhookAuthToken`: the exact value RevenueCat sends in the webhook's
 *    `Authorization` header (configured in the RevenueCat dashboard). The
 *    webhook rejects any request whose header doesn't match.
 */
export const revenueCatConfig = registerAs('revenuecat', () => ({
  secretApiKey: process.env.REVENUECAT_SECRET_API_KEY ?? '',
  webhookAuthToken: process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN ?? '',
}));
