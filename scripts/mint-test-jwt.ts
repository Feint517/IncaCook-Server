/**
 * Mints a Supabase-compatible JWT for local testing. The IncaCook server's
 * SupabaseJwtStrategy validates against SUPABASE_JWT_SECRET + aud=authenticated,
 * so a locally-signed JWT with the right claims passes auth without going
 * through Supabase signup.
 *
 * Usage:
 *   pnpm tsx scripts/mint-test-jwt.ts <admin|buyer|seller|driver>
 *
 * The four roles share fixed UUIDs with the seed script (prisma/seed.ts) so
 * the token's `sub` claim resolves to the seeded User row.
 *
 * The token is printed to stdout — pipe it into your curl/HTTPie scripts:
 *   TOKEN=$(pnpm -s mint-jwt buyer)
 *   curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/users/me
 *
 * Never use this in production. The IDs are fixed and the script signs
 * against the same JWT secret as Supabase — a leaked token is a real
 * credential for whichever seed user it represents.
 */

// Run via the `mint-jwt` script in package.json, which passes
// `tsx --env-file=.env` so process.env is populated from .env.
import jwt from 'jsonwebtoken';

export const TEST_USER_SUPABASE_IDS = {
  admin: '00000000-0000-0000-0000-000000000001',
  buyer: '00000000-0000-0000-0000-000000000002',
  seller: '00000000-0000-0000-0000-000000000003',
  driver: '00000000-0000-0000-0000-000000000004',
} as const;

type TestRole = keyof typeof TEST_USER_SUPABASE_IDS;

const ROLE_CLAIM: Record<TestRole, string> = {
  admin: 'ADMIN',
  buyer: 'BUYER',
  seller: 'SELLER',
  driver: 'DRIVER',
};

function main(): void {
  const role = process.argv[2] as TestRole | undefined;
  if (!role || !(role in TEST_USER_SUPABASE_IDS)) {
    console.error('Usage: pnpm tsx scripts/mint-test-jwt.ts <admin|buyer|seller|driver>');
    process.exit(1);
  }

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error('SUPABASE_JWT_SECRET not set in environment');
    process.exit(1);
  }

  const sub = TEST_USER_SUPABASE_IDS[role];
  const email = `test+${role}@incacook.test`;

  const token = jwt.sign(
    {
      sub,
      email,
      // SupabaseJwtStrategy defaults role to BUYER when missing; we set
      // it explicitly so middleware-level role inspection sees the truth.
      // The DB lookup in RolesGuard is the source of truth on admin routes.
      role: ROLE_CLAIM[role],
      aud: 'authenticated',
    },
    secret,
    { expiresIn: '24h' },
  );

  process.stdout.write(token);
}

main();
