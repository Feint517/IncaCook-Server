import { registerAs } from '@nestjs/config';

export const stripeConfig = registerAs('stripe', () => ({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  connectClientId: process.env.STRIPE_CONNECT_CLIENT_ID ?? '',
}));

export type StripeConfig = ReturnType<typeof stripeConfig>;
