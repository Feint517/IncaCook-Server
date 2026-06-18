import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY ?? '';
const country = process.env.STRIPE_CONNECT_ACCOUNT_COUNTRY ?? 'US';
const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });

async function main() {
  console.log('key prefix:', key.slice(0, 8), '| country:', country);
  try {
    const acct = await stripe.accounts.create({
      type: 'express',
      country,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { diag: 'true' },
    });
    console.log('ACCOUNT OK:', acct.id);
    const link = await stripe.accountLinks.create({
      account: acct.id,
      type: 'account_onboarding',
      return_url: process.env.STRIPE_ONBOARDING_RETURN_URL ?? '',
      refresh_url: process.env.STRIPE_ONBOARDING_REFRESH_URL ?? '',
    });
    console.log('LINK OK:', link.url.slice(0, 60), '...');
  } catch (e: any) {
    console.log('--- STRIPE ERROR ---');
    console.log('type      :', e?.type);
    console.log('code      :', e?.code);
    console.log('statusCode:', e?.statusCode);
    console.log('message   :', e?.message);
    console.log('param     :', e?.raw?.param);
    console.log('doc_url   :', e?.raw?.doc_url);
  }
}
main();
