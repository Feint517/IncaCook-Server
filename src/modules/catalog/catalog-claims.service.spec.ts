import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { CatalogClaimsService } from './catalog-claims.service';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Kitchen catalog SAV claims: a seller opens a claim on their own paid order
 * within 14 days; admins refund / request replacement / reject / resolve.
 * Prisma + Stripe + notifications are mocked.
 */
describe('CatalogClaimsService', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let orderUpdate: ReturnType<typeof vi.fn>;
  let claimFindFirst: ReturnType<typeof vi.fn>;
  let claimFindUnique: ReturnType<typeof vi.fn>;
  let claimFindMany: ReturnType<typeof vi.fn>;
  let claimCreate: ReturnType<typeof vi.fn>;
  let claimUpdate: ReturnType<typeof vi.fn>;
  let refundsCreate: ReturnType<typeof vi.fn>;
  let sendToUsers: ReturnType<typeof vi.fn>;
  let service: CatalogClaimsService;

  function order(overrides: Record<string, unknown> = {}) {
    return {
      id: 'o1',
      sellerId: 'seller-1',
      status: 'PAID',
      totalCents: 5000,
      stripePaymentIntentId: 'pi_1',
      paidAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    };
  }

  function claim(overrides: Record<string, unknown> = {}) {
    return {
      id: 'c1',
      catalogOrderId: 'o1',
      sellerId: 'seller-1',
      type: 'DEFECTIVE',
      status: 'OPEN',
      description: 'cassé',
      adminNotes: null,
      replacementNotes: null,
      stripeRefundId: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    userFindUnique = vi.fn().mockResolvedValue({ id: 'seller-1' });
    orderFindUnique = vi.fn().mockResolvedValue(order());
    orderUpdate = vi.fn().mockResolvedValue({});
    claimFindFirst = vi.fn().mockResolvedValue(null);
    claimFindUnique = vi.fn().mockResolvedValue(claim());
    claimFindMany = vi.fn().mockResolvedValue([]);
    claimCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
      ...data,
    }));
    claimUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...claim(),
      ...data,
    }));
    refundsCreate = vi.fn().mockResolvedValue({ id: 're_1' });
    sendToUsers = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      db: {
        user: { findUnique: userFindUnique },
        catalogOrder: { findUnique: orderFindUnique, update: orderUpdate },
        catalogClaim: {
          findFirst: claimFindFirst,
          findUnique: claimFindUnique,
          findMany: claimFindMany,
          create: claimCreate,
          update: claimUpdate,
        },
      },
    } as unknown as PrismaService;

    const stripe = { client: { refunds: { create: refundsCreate } } } as never;
    service = new CatalogClaimsService(prisma, stripe, { sendToUsers } as never);
  });

  // --- Seller create ------------------------------------------------------

  it('lets a seller open a claim on their own paid order within 14 days', async () => {
    const created = await service.createClaim('sup-1', 'o1', {
      type: 'DEFECTIVE',
      description: 'cassé',
    });

    expect(claimCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          catalogOrderId: 'o1',
          sellerId: 'seller-1',
          type: 'DEFECTIVE',
          status: 'OPEN',
          description: 'cassé',
        }),
      }),
    );
    expect(created.status).toBe('OPEN');
    // Seller is notified of the new claim.
    expect(sendToUsers).toHaveBeenCalledWith(['seller-1'], expect.objectContaining({}));
  });

  it('rejects a claim from a seller who does not own the order', async () => {
    orderFindUnique.mockResolvedValue(order({ sellerId: 'seller-2' }));

    await expect(
      service.createClaim('sup-1', 'o1', { type: 'WRONG_ITEM', description: 'x' }),
    ).rejects.toThrow('Cette commande catalogue ne vous appartient pas');
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it('rejects a claim past the 14-day window', async () => {
    orderFindUnique.mockResolvedValue(order({ paidAt: new Date(Date.now() - 20 * DAY) }));

    await expect(
      service.createClaim('sup-1', 'o1', { type: 'NEVER_RECEIVED', description: 'x' }),
    ).rejects.toThrow('La fenêtre de réclamation de 14 jours est dépassée');
  });

  it('rejects a duplicate open claim for the same order/type', async () => {
    claimFindFirst.mockResolvedValue({ id: 'c0' });

    await expect(
      service.createClaim('sup-1', 'o1', { type: 'DEFECTIVE', description: 'x' }),
    ).rejects.toThrow('Une réclamation est déjà ouverte pour cette commande');
  });

  it('rejects a claim on a non-eligible (unpaid) order', async () => {
    orderFindUnique.mockResolvedValue(order({ status: 'PENDING' }));

    await expect(
      service.createClaim('sup-1', 'o1', { type: 'DEFECTIVE', description: 'x' }),
    ).rejects.toThrow('Commande catalogue non éligible à une réclamation');
  });

  // --- Admin actions ------------------------------------------------------

  it('refunds via Stripe and marks the claim REFUNDED', async () => {
    const updated = await service.adminRefund('c1', 'admin-1', {});

    expect(refundsCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 5000 },
      expect.objectContaining({ idempotencyKey: 'catalog_refund_c1' }),
    );
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REFUNDED' }) }),
    );
    expect(updated.status).toBe('REFUNDED');
  });

  it('refund is idempotent — a second call does not refund again', async () => {
    claimFindUnique
      .mockResolvedValueOnce(claim({ status: 'OPEN' }))
      .mockResolvedValueOnce(claim({ status: 'REFUNDED', stripeRefundId: 're_1' }));

    await service.adminRefund('c1', 'admin-1', {});
    await service.adminRefund('c1', 'admin-1', {});

    expect(refundsCreate).toHaveBeenCalledTimes(1);
  });

  it('refunds a partial amount when specified', async () => {
    await service.adminRefund('c1', 'admin-1', { refundAmountCents: 2000 });
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 2000 }),
      expect.anything(),
    );
  });

  it('requests a replacement', async () => {
    const updated = await service.adminRequestReplacement('c1', 'admin-1', {
      replacementNotes: 'renvoi sous 5j',
    });
    expect(updated.status).toBe('REPLACEMENT_REQUESTED');
    expect(claimUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REPLACEMENT_REQUESTED',
          replacementNotes: 'renvoi sous 5j',
        }),
      }),
    );
  });

  it('rejects a claim', async () => {
    const updated = await service.adminReject('c1', 'admin-1', { notes: 'non justifié' });
    expect(updated.status).toBe('REJECTED');
  });

  it('resolves a claim', async () => {
    const updated = await service.adminResolve('c1', 'admin-1', {});
    expect(updated.status).toBe('RESOLVED');
  });

  it('admin list filters by status and type', async () => {
    await service.adminList({ status: 'OPEN', type: 'DEFECTIVE', search: '  ' });
    expect(claimFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'OPEN', type: 'DEFECTIVE' } }),
    );
  });
});
