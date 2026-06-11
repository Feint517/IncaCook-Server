import { registerAs } from '@nestjs/config';

/**
 * Prelude Verify V2 (https://docs.prelude.so/verify). Phone OTP provider —
 * replaces Twilio/Supabase SMS. The key is server-side only; never exposed to
 * clients. `baseUrl` already includes the `/v2` prefix.
 */
export const preludeConfig = registerAs('prelude', () => ({
  apiKey: process.env.PRELUDE_API_KEY ?? '',
  baseUrl: process.env.PRELUDE_BASE_URL ?? 'https://api.prelude.dev/v2',
}));

export type PreludeConfig = ReturnType<typeof preludeConfig>;
