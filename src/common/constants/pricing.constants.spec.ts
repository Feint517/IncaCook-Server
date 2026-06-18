import { describe, expect, it } from 'vitest';

import { DELIVERY_FEE_CENTS, priceOrder } from './pricing.constants';

/**
 * Pricing math: flat 5,00 € delivery + 5% platform buyer fee on
 * (subtotal + delivery). Seller commission (25%/30%, 1 € floor) is unaffected
 * by the delivery fee.
 */
describe('priceOrder', () => {
  it('delivery order, subtotal 2000 → delivery 500, platform fee 125, total 2625', () => {
    const t = priceOrder(2000, { isPremium: false, isDelivery: true });
    expect(t.fulfillmentFeeCents).toBe(500);
    expect(t.platformBuyerFeeCents).toBe(125); // round((2000+500) * 5%)
    expect(t.buyerTotalCents).toBe(2625);
    // Driver earns the delivery fee; seller earning is dishes − commission.
    expect(t.commissionCents).toBe(600); // 30% of 2000
    expect(t.sellerEarningsCents).toBe(1400); // unaffected by delivery
  });

  it('pickup order has no delivery fee; platform fee is on subtotal only', () => {
    const t = priceOrder(2000, { isPremium: false, isDelivery: false });
    expect(t.fulfillmentFeeCents).toBe(0);
    expect(t.platformBuyerFeeCents).toBe(100); // round(2000 * 5%)
    expect(t.buyerTotalCents).toBe(2100);
    // Seller earning identical to the delivery case — delivery never touches it.
    expect(t.sellerEarningsCents).toBe(1400);
  });

  it('premium seller pays 25% commission; delivery + platform fee unchanged', () => {
    const t = priceOrder(2000, { isPremium: true, isDelivery: true });
    expect(t.commissionCents).toBe(500); // 25% of 2000
    expect(t.sellerEarningsCents).toBe(1500);
    expect(t.fulfillmentFeeCents).toBe(500);
    expect(t.platformBuyerFeeCents).toBe(125);
    expect(t.buyerTotalCents).toBe(2625);
  });

  it('the flat delivery fee constant is 500 (5,00 €)', () => {
    expect(DELIVERY_FEE_CENTS).toBe(500);
  });

  it('buyer total always reconciles with the split', () => {
    for (const subtotal of [199, 1000, 2010, 4999, 12345]) {
      for (const isDelivery of [true, false]) {
        const t = priceOrder(subtotal, { isPremium: false, isDelivery });
        expect(
          t.commissionCents +
            t.sellerEarningsCents +
            t.fulfillmentFeeCents +
            t.platformBuyerFeeCents,
        ).toBe(t.buyerTotalCents);
      }
    }
  });
});
