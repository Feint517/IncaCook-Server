/**
 * End-to-end check of POST /v1/stripe/onboarding/account-link against the
 * locally-running backend, using a real DRIVER from the DB + a minted JWT.
 * Diagnostic only — safe to delete.
 */
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const API = 'http://localhost:3000';

async function main() {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('SUPABASE_JWT_SECRET missing');
  const prisma = new PrismaClient();

  const driver = await prisma.user.findFirst({
    where: { role: 'DRIVER', deletedAt: null },
    select: {
      id: true,
      supabaseId: true,
      email: true,
      driverProfile: {
        select: { stripeConnectAccountId: true, stripeOnboardingCompleted: true, kycStatus: true },
      },
    },
  });
  await prisma.$disconnect();

  if (!driver) {
    console.log('No DRIVER user found in the DB.');
    return;
  }
  console.log('Driver:', driver.email, '| id:', driver.id);
  console.log(
    '  before → connectAccountId:',
    driver.driverProfile?.stripeConnectAccountId ?? 'null',
    '| onboardingCompleted:',
    driver.driverProfile?.stripeOnboardingCompleted,
    '| kyc:',
    driver.driverProfile?.kycStatus,
  );

  const token = jwt.sign(
    { sub: driver.supabaseId, email: driver.email, role: 'DRIVER', aud: 'authenticated' },
    secret,
    { expiresIn: '10m' },
  );

  const res = await fetch(`${API}/v1/stripe/onboarding/account-link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  console.log('\nPOST /v1/stripe/onboarding/account-link → HTTP', res.status);
  console.log(JSON.stringify(body, null, 2));
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
