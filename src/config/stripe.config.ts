import { registerAs } from '@nestjs/config';

export const stripeConfig = registerAs('stripe', () => ({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  connectClientId: process.env.STRIPE_CONNECT_CLIENT_ID ?? '',

  // Connect Express onboarding return targets. Stripe redirects here after
  // the user completes (or abandons) onboarding. For mobile, point at the
  // Flutter app's universal-link host or a deep-link bridge. Empty in dev
  // until set; the service throws if the endpoint is hit without config.
  onboardingReturnUrl: process.env.STRIPE_ONBOARDING_RETURN_URL ?? '',
  onboardingRefreshUrl: process.env.STRIPE_ONBOARDING_REFRESH_URL ?? '',
}));

export type StripeConfig = ReturnType<typeof stripeConfig>;
