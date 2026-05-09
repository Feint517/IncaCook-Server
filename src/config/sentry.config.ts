import { registerAs } from '@nestjs/config';

export const sentryConfig = registerAs('sentry', () => ({
  dsn: process.env.SENTRY_DSN ?? '',
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  enabled: Boolean(process.env.SENTRY_DSN) && process.env.NODE_ENV === 'production',
}));

export type SentryConfig = ReturnType<typeof sentryConfig>;
