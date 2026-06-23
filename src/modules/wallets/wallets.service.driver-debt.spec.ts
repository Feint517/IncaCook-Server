import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { WalletService } from './wallets.service';

/**
 * Driver wallet debt: when a driver disappears after pickup the refunded amount
 * is booked as a negative AVAILABLE DRIVER_DEBT entry. It nets against the
 * balance, surfaces as `debtCents`, blocks cashout while negative, and is
 * naturally offset (and settled) by future earnings on the next withdrawal.
 */
describe('WalletService — driver debt / negative balance', () => {
  let aggregate: ReturnType<typeof vi.fn>;
  let createMany: ReturnType<typeof vi.fn>;
  let findManyEntries: ReturnType<typeof vi.fn>;
  let updateMany: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;
  let driverProfileFindUnique: ReturnType<typeof vi.fn>;
  let transfersCreate: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let service: WalletService;

  beforeEach(() => {
    aggregate = vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } });
    createMany = vi.fn().mockResolvedValue({ count: 1 });
    findManyEntries = vi.fn().mockResolvedValue([]);
    updateMany = vi.fn().mockResolvedValue({ count: 0 });
    create = vi.fn().mockResolvedValue({});
    userFindUnique = vi.fn().mockResolvedValue({ id: 'driver-1', role: 'DRIVER' });
    driverProfileFindUnique = vi
      .fn()
      .mockResolvedValue({ stripeConnectAccountId: 'acct_1', stripeOnboardingCompleted: true });
    transfersCreate = vi.fn().mockResolvedValue({ id: 'tr_1' });
    transaction = vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops));

    const prisma = {
      $transaction: transaction,
      db: {
        user: { findUnique: userFindUnique },
        driverProfile: { findUnique: driverProfileFindUnique },
        walletEntry: { aggregate, createMany, findMany: findManyEntries, updateMany, create },
      },
    } as unknown as PrismaService;

    const stripe = { client: { transfers: { create: transfersCreate } } } as never;
    service = new WalletService(prisma, stripe, {} as never);
    logSpy = vi.spyOn(Logger.prototype, 'log');
  });

  afterEach(() => logSpy.mockRestore());

  /** Makes sumByStatus return per-status totals for the summary aggregate calls. */
  function mockStatusSums(sums: Record<string, number>) {
    aggregate.mockImplementation(({ where }: { where: { status: string } }) =>
      Promise.resolve({ _sum: { amountCents: sums[where.status] ?? 0 } }),
    );
  }

  it('records a negative AVAILABLE DRIVER_DEBT entry equal to the refund', async () => {
    await service.recordDriverDebt('o1', 'driver-1', 1500);

    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            userId: 'driver-1',
            orderId: 'o1',
            type: 'DRIVER_DEBT',
            amountCents: -1500,
            status: 'AVAILABLE',
          }),
        ],
        skipDuplicates: true,
      }),
    );
  });

  it('does not record a zero/negative debt', async () => {
    await service.recordDriverDebt('o1', 'driver-1', 0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('summary exposes debtCents and zeroes available when in net debt', async () => {
    mockStatusSums({ AVAILABLE: -1500, PENDING: 0, HELD: 0, PAID_OUT: 0 });

    const s = await service.summary('sup-1');

    expect(s.debtCents).toBe(1500);
    expect(s.availableCents).toBe(0);
    expect(s.canWithdraw).toBe(false);
  });

  it('summary nets a debt against positive earnings (no debt left)', async () => {
    // e.g. +6000 earnings − 2000 debt = +4000 net AVAILABLE.
    mockStatusSums({ AVAILABLE: 4000, PENDING: 0, HELD: 0, PAID_OUT: 0 });

    const s = await service.summary('sup-1');

    expect(s.availableCents).toBe(4000);
    expect(s.debtCents).toBe(0);
  });

  it('blocks cashout while the driver is in debt', async () => {
    // +1000 earning − 3000 debt = −2000 net.
    findManyEntries.mockResolvedValue([
      { id: 'e1', amountCents: 1000, type: 'DELIVERY_EARNING' },
      { id: 'e2', amountCents: -3000, type: 'DRIVER_DEBT' },
    ]);

    await expect(service.requestWithdrawal('sup-1')).rejects.toThrow(
      'Retrait impossible : votre solde présente une dette.',
    );
    // Never reaches Stripe.
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('future earnings offset the debt and the surplus is withdrawable', async () => {
    // +8000 earnings − 3000 debt = +5000 net (>= the 5000 minimum).
    findManyEntries.mockResolvedValue([
      { id: 'e1', amountCents: 8000, type: 'DELIVERY_EARNING' },
      { id: 'e2', amountCents: -3000, type: 'DRIVER_DEBT' },
    ]);

    const res = await service.requestWithdrawal('sup-1');

    // The surplus (net of debt) is what's transferred.
    expect(transfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000 }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('withdrawal_') }),
    );
    expect(res.amountCents).toBe(5000);
    // The debt row is settled alongside the earning (flipped to PAID_OUT).
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['e1', 'e2'] } } }),
    );
    expect(
      logSpy.mock.calls.some((c) =>
        String(c[0]).includes('[DriverDebt] future earning offset debt'),
      ),
    ).toBe(true);
  });
});
