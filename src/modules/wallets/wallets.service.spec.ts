import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { WalletService } from './wallets.service';

/**
 * 24h pending-balance safety window: earnings are credited PENDING at delivery
 * and only released to AVAILABLE after the window, provided the order is still
 * delivered. Cashout uses AVAILABLE only. Prisma + Stripe + notifications are
 * mocked.
 */
describe('WalletService — pending balance + 24h release', () => {
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let orderFindMany: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;
  let sellerProfileFindUnique: ReturnType<typeof vi.fn>;
  let entryCreateMany: ReturnType<typeof vi.fn>;
  let entryFindMany: ReturnType<typeof vi.fn>;
  let entryUpdateMany: ReturnType<typeof vi.fn>;
  let entryCreate: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let transfersCreate: ReturnType<typeof vi.fn>;
  let sendToUsers: ReturnType<typeof vi.fn>;
  let service: WalletService;

  beforeEach(() => {
    orderFindUnique = vi.fn();
    orderFindMany = vi.fn().mockResolvedValue([]);
    userFindUnique = vi.fn();
    sellerProfileFindUnique = vi.fn();
    entryCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    entryFindMany = vi.fn().mockResolvedValue([]);
    entryUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    entryCreate = vi.fn().mockResolvedValue({});
    transaction = vi.fn().mockResolvedValue([]);
    transfersCreate = vi.fn().mockResolvedValue({ id: 'tr_1' });
    sendToUsers = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      $transaction: transaction,
      db: {
        order: { findUnique: orderFindUnique, findMany: orderFindMany },
        user: { findUnique: userFindUnique },
        sellerProfile: { findUnique: sellerProfileFindUnique },
        driverProfile: { findUnique: vi.fn() },
        walletEntry: {
          createMany: entryCreateMany,
          findMany: entryFindMany,
          updateMany: entryUpdateMany,
          create: entryCreate,
          aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }),
        },
      },
    } as unknown as PrismaService;

    const stripe = { client: { transfers: { create: transfersCreate } } } as never;
    service = new WalletService(prisma, stripe, { sendToUsers } as never);
  });

  function creditedRows(): Array<Record<string, unknown>> {
    return entryCreateMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
  }

  it('credits a delivered order seller earning as PENDING (commission stays AVAILABLE)', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      sellerId: 'seller-1',
      status: 'DELIVERED',
      fulfillmentChoice: 'PICKUP',
      sellerEarningsCents: 1000,
      commissionCents: 200,
      fulfillmentFeeCents: 0,
      deliveries: [],
    });

    await service.creditForCompletedOrder('o1');

    const rows = creditedRows();
    const seller = rows.find((r) => r.type === 'ORDER_EARNING');
    expect(seller?.status).toBe('PENDING');
    expect(seller?.userId).toBe('seller-1');
    expect(seller?.availableAt).toBeInstanceOf(Date);
    const commission = rows.find((r) => r.type === 'COMMISSION');
    expect(commission?.status).toBe('AVAILABLE');
  });

  it('credits a delivered DELIVERY order driver earning as PENDING', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      sellerId: 'seller-1',
      status: 'DELIVERED',
      fulfillmentChoice: 'DELIVERY',
      sellerEarningsCents: 1000,
      commissionCents: 200,
      fulfillmentFeeCents: 300,
      deliveries: [{ driverId: 'driver-1', deliveredAt: new Date('2026-06-19T10:00:00Z') }],
    });

    await service.creditForCompletedOrder('o1');

    const driver = creditedRows().find((r) => r.type === 'DELIVERY_EARNING');
    expect(driver?.status).toBe('PENDING');
    expect(driver?.userId).toBe('driver-1');
    // availableAt = deliveredAt + 24h.
    expect((driver?.availableAt as Date).toISOString()).toBe('2026-06-20T10:00:00.000Z');
  });

  it('rejects a withdrawal when only PENDING balance exists (not withdrawable)', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-1', role: 'SELLER' });
    entryFindMany.mockResolvedValue([]); // no AVAILABLE entries

    await expect(service.requestWithdrawal('sub-seller')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('cashout transfers only the AVAILABLE balance', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-1', role: 'SELLER' });
    entryFindMany.mockResolvedValue([{ id: 'a1', amountCents: 6000 }]); // AVAILABLE only
    sellerProfileFindUnique.mockResolvedValue({
      stripeConnectAccountId: 'acct_1',
      stripeOnboardingCompleted: true,
    });

    const res = await service.requestWithdrawal('sub-seller');

    expect(transfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 6000, destination: 'acct_1' }),
      expect.anything(),
    );
    expect(res.amountCents).toBe(6000);
  });

  it('releases due PENDING entries to AVAILABLE when the order is still delivered', async () => {
    entryFindMany.mockResolvedValue([{ id: 'e1', userId: 'seller-1', orderId: 'o1' }]);
    orderFindMany.mockResolvedValue([{ id: 'o1', status: 'DELIVERED' }]);

    const res = await service.releaseDuePendingEntries(new Date('2026-06-20T11:00:00Z'));

    expect(res.released).toBe(1);
    expect(entryUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1'] }, status: 'PENDING' },
      data: { status: 'AVAILABLE', releasedAt: expect.any(Date) },
    });
    expect(sendToUsers).toHaveBeenCalledWith(['seller-1'], expect.objectContaining({}));
  });

  it('is idempotent: a sweep with nothing due makes no changes', async () => {
    entryFindMany.mockResolvedValue([]);

    const res = await service.releaseDuePendingEntries();

    expect(res.released).toBe(0);
    expect(entryUpdateMany).not.toHaveBeenCalled();
  });

  it('does not release pending entries for a refunded/cancelled order (reverses them)', async () => {
    entryFindMany.mockResolvedValue([{ id: 'e1', userId: 'seller-1', orderId: 'o1' }]);
    orderFindMany.mockResolvedValue([{ id: 'o1', status: 'CANCELLED' }]);

    const res = await service.releaseDuePendingEntries(new Date());

    expect(res.released).toBe(0);
    // Reversed to CANCELLED, never flipped to AVAILABLE.
    expect(entryUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1'] }, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    expect(entryUpdateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'AVAILABLE' }) }),
    );
    expect(sendToUsers).not.toHaveBeenCalled();
  });
});
