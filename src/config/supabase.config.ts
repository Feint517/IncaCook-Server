import { registerAs } from '@nestjs/config';

export const supabaseConfig = registerAs('supabase', () => ({
  url: process.env.SUPABASE_URL ?? '',
  anonKey: process.env.SUPABASE_ANON_KEY ?? '',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  jwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  buckets: {
    listings: process.env.SUPABASE_STORAGE_BUCKET_LISTINGS ?? 'listings',
    kyc: process.env.SUPABASE_STORAGE_BUCKET_KYC ?? 'kyc',
    avatars: process.env.SUPABASE_STORAGE_BUCKET_AVATARS ?? 'avatars',
  },
}));

export type SupabaseConfig = ReturnType<typeof supabaseConfig>;
