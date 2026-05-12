/**
 * One-shot setup: creates two Stripe Express test-mode Connect accounts (one
 * for the seeded seller, one for the seeded driver), then prints AccountLink
 * URLs you click through once in a browser to activate `transfers` +
 * `card_payments` capabilities. After that, paste the printed IDs into
 * `.env.test` and re-seed.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.test scripts/setup-stripe-test-accounts.ts create
 *   # ...click through both URLs in browser, use "test data" auto-fill...
 *   pnpm tsx --env-file=.env.test scripts/setup-stripe-test-accounts.ts verify <seller_acct_id> <driver_acct_id>
 */
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY. Run with --env-file=.env.test.');
  process.exit(1);
}
if (!STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY is not a test-mode key. Refusing to run.');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' });

const RETURN_URL = 'http://localhost:3000/stub/stripe/return';
const REFRESH_URL = 'http://localhost:3000/stub/stripe/refresh';

async function createOne(label: string, email: string): Promise<string> {
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'FR',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'individual',
    metadata: { seed_label: label },
  });

  const link = await stripe.accountLinks.create({
    account: account.id,
    type: 'account_onboarding',
    return_url: RETURN_URL,
    refresh_url: REFRESH_URL,
  });

  console.log(`\n[${label}]`);
  console.log(`  account id : ${account.id}`);
  console.log(`  onboarding : ${link.url}`);
  return account.id;
}

async function create(): Promise<void> {
  console.log('Creating two Express test accounts...');
  const sellerId = await createOne('seller', 'test+seller@incacook.test');
  const driverId = await createOne('driver', 'test+driver@incacook.test');

  console.log('\n---');
  console.log('Next steps:');
  console.log('1. Open each onboarding URL above in your browser.');
  console.log('   In test mode, click "Use test data" to auto-fill the form,');
  console.log('   then "Skip this step" / "Submit" until you land on the');
  console.log('   return URL. Repeat for both accounts.');
  console.log('2. Verify capabilities are active:');
  console.log(`   pnpm tsx --env-file=.env.test scripts/setup-stripe-test-accounts.ts verify ${sellerId} ${driverId}`);
  console.log('3. Paste these into .env.test:');
  console.log(`   TEST_SELLER_STRIPE_ACCOUNT_ID=${sellerId}`);
  console.log(`   TEST_DRIVER_STRIPE_ACCOUNT_ID=${driverId}`);
  console.log('4. Re-seed:  pnpm test:db:seed');
}

async function verify(sellerId: string, driverId: string): Promise<void> {
  const check = async (label: string, id: string): Promise<boolean> => {
    const acct = await stripe.accounts.retrieve(id);
    const transfers = acct.capabilities?.transfers ?? 'missing';
    const charges = acct.capabilities?.card_payments ?? 'missing';
    const ready = transfers === 'active';
    const tag = ready ? 'OK ' : 'NOT ready';
    console.log(`[${tag}] ${label} (${id})`);
    console.log(`        transfers=${transfers}  card_payments=${charges}`);
    console.log(`        charges_enabled=${acct.charges_enabled} payouts_enabled=${acct.payouts_enabled} details_submitted=${acct.details_submitted}`);
    return ready;
  };

  const a = await check('seller', sellerId);
  const b = await check('driver', driverId);
  if (a && b) {
    console.log('\nBoth accounts have transfers active. Safe to use for smoke testing.');
    process.exit(0);
  } else {
    console.log('\nAt least one account is not transfer-ready. Re-open its onboarding URL.');
    process.exit(2);
  }
}

async function link(accountId: string): Promise<void> {
  const l = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: RETURN_URL,
    refresh_url: REFRESH_URL,
  });
  console.log(`\nFresh onboarding URL for ${accountId}:\n  ${l.url}\n`);
}

const [, , cmd, a, b] = process.argv;
if (cmd === 'create') {
  create().catch((e) => { console.error(e); process.exit(1); });
} else if (cmd === 'verify' && a && b) {
  verify(a, b).catch((e) => { console.error(e); process.exit(1); });
} else if (cmd === 'link' && a) {
  link(a).catch((e) => { console.error(e); process.exit(1); });
} else {
  console.error('Usage:');
  console.error('  setup-stripe-test-accounts.ts create');
  console.error('  setup-stripe-test-accounts.ts verify <seller_acct_id> <driver_acct_id>');
  console.error('  setup-stripe-test-accounts.ts link <acct_id>');
  process.exit(64);
}
