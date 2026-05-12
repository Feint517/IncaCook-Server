import { z } from 'zod';

const portSchema = z.coerce.number().int().min(1).max(65535);

export const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: portSchema.default(3000),
  API_VERSION: z.string().default('v1'),
  APP_NAME: z.string().default('incacook-api'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),

  // Storage
  SUPABASE_STORAGE_BUCKET_LISTINGS: z.string().default('listings'),
  SUPABASE_STORAGE_BUCKET_KYC: z.string().default('kyc'),
  SUPABASE_STORAGE_BUCKET_AVATARS: z.string().default('avatars'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: portSchema.default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_CONNECT_CLIENT_ID: z.string().min(1),
  // Connect onboarding return targets (Account Links). Optional at boot
  // so devs not yet wiring Stripe can still start the server; the
  // onboarding service rejects requests if either is empty.
  STRIPE_ONBOARDING_RETURN_URL: z.union([z.literal(''), z.string().url()]).default(''),
  STRIPE_ONBOARDING_REFRESH_URL: z.union([z.literal(''), z.string().url()]).default(''),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_PHONE_NUMBER: z.string().optional().default(''),

  // Firebase
  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(''),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(''),

  // Mapbox
  MAPBOX_ACCESS_TOKEN: z.string().optional().default(''),

  // Email
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().email().default('noreply@incacook.com'),

  // Sentry
  SENTRY_DSN: z.string().optional().default(''),
  SENTRY_ENVIRONMENT: z.string().default('development'),

  // JWT
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRATION: z.string().default('7d'),

  // Rate limiting
  RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // Business rules
  COMMISSION_PERCENTAGE_STANDARD: z.coerce.number().min(0).max(100).default(30),
  COMMISSION_PERCENTAGE_PREMIUM: z.coerce.number().min(0).max(100).default(25),
  COMMISSION_MINIMUM_EUROS: z.coerce.number().min(0).default(1),
  DELIVERY_FEE_EUROS: z.coerce.number().min(0).default(2.5),
  WITHDRAWAL_MINIMUM_EUROS: z.coerce.number().min(0).default(50),
  LE_BON_FAIT_MAISON_PRICE_CAP: z.coerce.number().min(0).default(4.5),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const formatted = parsed.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return parsed.data;
}
