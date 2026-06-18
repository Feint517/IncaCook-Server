/**
 * Creates (or repairs) a real admin login for the IncaCook admin dashboard.
 *
 *   pnpm exec tsx --env-file=.env scripts/create-admin.ts
 *
 * What it does (idempotent, NON-destructive — never wipes seed data):
 *   1. Creates a Supabase Auth user (email + password, email pre-confirmed)
 *      via the service-role admin API. If it already exists, resets its
 *      password instead.
 *   2. Upserts the IncaCook `User` row with role=ADMIN, linked by supabaseId,
 *      so `GET /v1/users/me` returns ADMIN and the dashboard accepts the login.
 *
 * Override email/password via env: ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm exec tsx …
 *
 * The dashboard logs in with these credentials via POST /v1/auth/signin.
 */
import { randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ulid } from 'ulid';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const EMAIL = (process.env.ADMIN_EMAIL ?? 'admin@incacook.app').trim().toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD ?? generatePassword();

/** Strong password with guaranteed upper/lower/digit/symbol. */
function generatePassword(): string {
  return `Inca!${randomBytes(12).toString('base64url')}7`;
}

/** Paginate Supabase auth users to find one by email (no getByEmail in v2). */
async function findAuthUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env (.env).');
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const prisma = new PrismaClient();

  // 1) Supabase Auth identity.
  let supabaseId: string;
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });

  if (created.error) {
    const msg = created.error.message ?? '';
    if (/already|registered|exists/i.test(msg)) {
      const existingId = await findAuthUserId(admin, EMAIL);
      if (!existingId) throw created.error;
      supabaseId = existingId;
      const upd = await admin.auth.admin.updateUserById(supabaseId, {
        password: PASSWORD,
        email_confirm: true,
      });
      if (upd.error) throw upd.error;
      console.log('• Supabase auth user already existed — password reset.');
    } else {
      throw created.error;
    }
  } else {
    supabaseId = created.data.user!.id;
    console.log('• Supabase auth user created.');
  }

  // 2) IncaCook User row with ADMIN role.
  await prisma.user.upsert({
    where: { supabaseId },
    update: { role: 'ADMIN', email: EMAIL, emailVerified: true },
    create: {
      id: ulid(),
      supabaseId,
      email: EMAIL,
      firstName: 'Inca',
      lastName: 'Admin',
      role: 'ADMIN',
      emailVerified: true,
      acceptedCgu: true,
      acceptedCgv: true,
      acceptedAt: new Date(),
    },
  });
  console.log('• IncaCook User row upserted as ADMIN.');

  await prisma.$disconnect();

  console.log('\n=================== ADMIN READY ===================');
  console.log(`  email    : ${EMAIL}`);
  console.log(`  password : ${PASSWORD}`);
  console.log(`  supabaseId: ${supabaseId}`);
  console.log('===================================================');
  console.log('Login at the admin dashboard (npm run dev → http://localhost:5174).');
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
