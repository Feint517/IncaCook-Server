import { registerAs } from '@nestjs/config';

export const stripeConfig = registerAs('stripe', () => ({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  connectClientId: process.env.STRIPE_CONNECT_CLIENT_ID ?? '',

  // Country for Connect Express accounts. Production is FR (EUR/FR-only
  // marketplace), but a US test platform can only create US connected
  // accounts, so this is overridable for local testing.
  connectAccountCountry: process.env.STRIPE_CONNECT_ACCOUNT_COUNTRY ?? 'FR',

  // Connect Express onboarding return targets. Stripe redirects here after
  // the user completes (or abandons) onboarding. For mobile, point at the
  // Flutter app's universal-link host or a deep-link bridge. Empty in dev
  // until set; the service throws if the endpoint is hit without config.
  onboardingReturnUrl: process.env.STRIPE_ONBOARDING_RETURN_URL ?? '',
  onboardingRefreshUrl: process.env.STRIPE_ONBOARDING_REFRESH_URL ?? '',

  // Mandatory seller platform subscription ($4/mo). `sellerSubscriptionPriceId`
  // is the recurring Price id created in Stripe (Product "Seller
  // Subscription"). The success/cancel URLs are where Stripe Checkout
  // redirects; portalReturnUrl is where the Billing Portal returns. For
  // mobile, point these at the app's deep-link / universal-link bridge.
  sellerSubscriptionPriceId: process.env.STRIPE_SELLER_SUBSCRIPTION_PRICE_ID ?? '',
  subscriptionSuccessUrl: process.env.STRIPE_SUBSCRIPTION_SUCCESS_URL ?? '',
  subscriptionCancelUrl: process.env.STRIPE_SUBSCRIPTION_CANCEL_URL ?? '',
  portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL ?? '',
}));

export type StripeConfig = ReturnType<typeof stripeConfig>;
