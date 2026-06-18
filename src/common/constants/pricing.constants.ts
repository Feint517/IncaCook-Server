/**
 * Single source of truth for order pricing. Used by the order-creation path
 * (OrdersService) and the seller-profile default, so the delivery fee and the
 * platform buyer fee can never drift across the codebase.
 *
 * Money model (product decision doc):
 *   - subtotal       = Σ dishes/items (+ add-ons)
 *   - delivery fee   = flat 5,00 € for DELIVERY orders, 0 for PICKUP
 *   - platform fee   = 5% added ON TOP of (subtotal + delivery), charged to buyer
 *   - buyer total    = subtotal + delivery + platform fee  (the Stripe amount)
 *   - seller earning = subtotal − seller commission (25%/30%, unchanged)
 *   - driver earning = delivery fee
 *   - platform take  = seller commission + platform buyer fee
 */

/** Reads a non-negative integer env var, falling back to [fallback]. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

// Seller commission tiers (unchanged): premium 25%, standard 30%, 1 € floor.
export const COMMISSION_RATE_BPS_STANDARD = 3000;
export const COMMISSION_RATE_BPS_PREMIUM = 2500;
export const COMMISSION_MIN_CENTS = 100;

/** Flat delivery fee for DELIVERY orders (5,00 €). Override with DELIVERY_FEE_CENTS. */
export const DELIVERY_FEE_CENTS = envInt(
  'DELIVERY_FEE_CENTS',
  envInt('DEFAULT_DELIVERY_FEE_CENTS', 500),
);

/** Platform buyer fee, in basis points of (subtotal + delivery). 500 bps = 5%. */
export const PLATFORM_BUYER_FEE_BPS = envInt('PLATFORM_BUYER_FEE_BPS', 500);

export interface OrderTotals {
  subtotalCents: number;
  fulfillmentFeeCents: number;
  commissionRateBps: number;
  commissionCents: number;
  sellerEarningsCents: number;
  platformBuyerFeeCents: number;
  buyerTotalCents: number;
}

/**
 * Pure order-pricing math. Given the items' subtotal and the seller/fulfillment
 * context, returns the full split. Kept side-effect-free so it's unit-testable
 * without a DB or Stripe.
 */
export function priceOrder(
  subtotalCents: number,
  opts: { isPremium: boolean; isDelivery: boolean },
): OrderTotals {
  const fulfillmentFeeCents = opts.isDelivery ? DELIVERY_FEE_CENTS : 0;

  const commissionRateBps = opts.isPremium
    ? COMMISSION_RATE_BPS_PREMIUM
    : COMMISSION_RATE_BPS_STANDARD;
  // Seller commission applies to the DISHES (subtotal) only, with a 1 € floor.
  const commissionCents = Math.max(
    Math.round((subtotalCents * commissionRateBps) / 10_000),
    COMMISSION_MIN_CENTS,
  );
  const sellerEarningsCents = subtotalCents - commissionCents;

  // Platform fee is 5% on top of (dishes + delivery), paid by the buyer.
  const platformBuyerFeeCents = Math.round(
    ((subtotalCents + fulfillmentFeeCents) * PLATFORM_BUYER_FEE_BPS) / 10_000,
  );
  const buyerTotalCents = subtotalCents + fulfillmentFeeCents + platformBuyerFeeCents;

  // Invariant: what the buyer pays = seller earning + commission + delivery +
  // platform fee. (commission + sellerEarnings === subtotal by construction.)
  if (
    commissionCents + sellerEarningsCents + fulfillmentFeeCents + platformBuyerFeeCents !==
    buyerTotalCents
  ) {
    throw new Error('Money math mismatch in order totals computation');
  }

  return {
    subtotalCents,
    fulfillmentFeeCents,
    commissionRateBps,
    commissionCents,
    sellerEarningsCents,
    platformBuyerFeeCents,
    buyerTotalCents,
  };
}
