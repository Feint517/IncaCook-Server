import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { StripeWebhookHandlerService } from './stripe-webhook-handler.service';

import type Stripe from 'stripe';

/**
 * Stripe chargeback (charge.dispute.*) → records an ADMIN_REVIEW CHARGEBACK
 * OrderDispute linked to the order, idempotent per Stripe dispute id, no
 * automatic refund/strike. Prisma is mocked.
 */
describe('StripeWebhookHandlerService — chargebacks', () => {
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let disputeFindUnique: ReturnType<typeof vi.fn>;
  let disputeCreate: ReturnType<typeof vi.fn>;
  let disputeUpdate: ReturnType<typeof vi.fn>;
  let service: StripeWebhookHandlerService;

  function dispute(overrides: Record<string, unknown> = {}): Stripe.Dispute {
    return {
      id: 'dp_1',
      amount: 1500,
      currency: 'eur',
      reason: 'fraudulent',
      status: 'needs_response',
      payment_intent: 'pi_1',
      evidence_details: { due_by: 1_900_000_000 },
      metadata: {},
      ...overrides,
    } as unknown as Stripe.Dispute;
  }

  function event(d: Stripe.Dispute, type = 'charge.dispute.created'): Stripe.Event {
    return { type, data: { object: d } } as unknown as Stripe.Event;
  }

  beforeEach(() => {
    orderFindUnique = vi
      .fn()
      .mockResolvedValue({ id: 'o1', buyerId: 'buyer-1', sellerId: 'seller-1' });
    disputeFindUnique = vi.fn().mockResolvedValue(null);
    disputeCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }));
    disputeUpdate = vi.fn().mockResolvedValue({});

    const prisma = {
      db: {
        order: { findUnique: orderFindUnique },
        orderDispute: {
          findUnique: disputeFindUnique,
          create: disputeCreate,
          update: disputeUpdate,
        },
      },
    } as unknown as PrismaService;

    service = new StripeWebhookHandlerService(prisma, {} as never, {} as never, {} as never);
  });

  it('creates an ADMIN_REVIEW chargeback record linked to the order', async () => {
    await service.handleEvent(event(dispute()));

    expect(disputeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: 'o1',
          buyerId: 'buyer-1',
          sellerId: 'seller-1',
          type: 'CHARGEBACK',
          status: 'ADMIN_REVIEW',
          stripeDisputeId: 'dp_1',
          metadata: expect.objectContaining({
            stripeDisputeId: 'dp_1',
            amount: 1500,
            reason: 'fraudulent',
            stripeStatus: 'needs_response',
          }),
        }),
      }),
    );
  });

  it('is idempotent for the same Stripe dispute id (updates, does not duplicate)', async () => {
    disputeFindUnique.mockResolvedValue({ id: 'disp1' });

    await service.handleEvent(event(dispute(), 'charge.dispute.updated'));

    expect(disputeCreate).not.toHaveBeenCalled();
    expect(disputeUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'disp1' } }));
  });

  it('resolves the order via metadata.orderId when no paymentIntent is set', async () => {
    // No payment_intent → PI lookup is skipped; the metadata.orderId lookup runs.
    orderFindUnique.mockResolvedValue({ id: 'o9', buyerId: 'buyer-9', sellerId: 'seller-9' });
    await service.handleEvent(
      event(dispute({ payment_intent: null, metadata: { orderId: 'o9' } })),
    );

    expect(orderFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o9' } }));
    expect(disputeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderId: 'o9' }) }),
    );
  });

  it('records nothing when no order can be linked', async () => {
    orderFindUnique.mockResolvedValue(null);
    await service.handleEvent(event(dispute({ payment_intent: null, metadata: {} })));
    expect(disputeCreate).not.toHaveBeenCalled();
  });
});
