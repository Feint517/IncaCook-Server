import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiVersion: process.env.API_VERSION ?? 'v1',
  name: process.env.APP_NAME ?? 'incacook-api',
  url: process.env.APP_URL ?? 'http://localhost:3000',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiration: process.env.JWT_EXPIRATION ?? '7d',
  },
  business: {
    commissionStandard: parseFloat(process.env.COMMISSION_PERCENTAGE_STANDARD ?? '30'),
    commissionPremium: parseFloat(process.env.COMMISSION_PERCENTAGE_PREMIUM ?? '25'),
    commissionMinimum: parseFloat(process.env.COMMISSION_MINIMUM_EUROS ?? '1'),
    deliveryFee: parseFloat(process.env.DELIVERY_FEE_EUROS ?? '2.5'),
    withdrawalMinimum: parseFloat(process.env.WITHDRAWAL_MINIMUM_EUROS ?? '50'),
    leBonFaitMaisonPriceCap: parseFloat(process.env.LE_BON_FAIT_MAISON_PRICE_CAP ?? '4.5'),
  },
}));

export type AppConfig = ReturnType<typeof appConfig>;
