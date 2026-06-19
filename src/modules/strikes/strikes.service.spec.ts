import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { StrikesService } from './strikes.service';

/**
 * Strike engine: light = 1pt, serious = 2pts; 3 active points (within 90 days)
 * → suspension; CRITICAL → immediate exclusion. One incident never strikes
 * twice. Prisma + notifications mocked.
 */
describe('StrikesService', () => {
  let strikeCreate: ReturnType<typeof vi.fn>;
  let strikeFindFirst: ReturnType<typeof vi.fn>;
  let strikeAggregate: ReturnType<typeof vi.fn>;
  let userUpdateMany: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;
  let sendToUsers: ReturnType<typeof vi.fn>;
  let service: StrikesService;

  beforeEach(() => {
    strikeCreate = vi.fn().mockResolvedValue({});
    strikeFindFirst = vi.fn().mockResolvedValue(null);
    strikeAggregate = vi.fn().mockResolvedValue({ _sum: { points: 1 } });
    userUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    userFindUnique = vi.fn().mockResolvedValue({ isSuspended: false });
    sendToUsers = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      db: {
        strike: { create: strikeCreate, findFirst: strikeFindFirst, aggregate: strikeAggregate },
        user: { updateMany: userUpdateMany, findUnique: userFindUnique },
      },
    } as unknown as PrismaService;

    service = new StrikesService(prisma, { sendToUsers } as never);
  });

  it('adds a light strike worth 1 point (below threshold → no suspension)', async () => {
    strikeAggregate.mockResolvedValue({ _sum: { points: 1 } });

    const res = await service.addStrike({
      userId: 'u1',
      role: 'SELLER',
      points: 1,
      reason: 'SELLER_UNAVAILABLE',
      severity: 'LIGHT',
      sourceType: 'DELIVERY',
      orderId: 'o1',
    });

    expect(strikeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ points: 1, severity: 'LIGHT' }) }),
    );
    expect(res).toEqual({ created: true, suspended: false });
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('adds a serious strike worth 2 points', async () => {
    strikeAggregate.mockResolvedValue({ _sum: { points: 2 } });

    await service.addStrike({
      userId: 'u1',
      role: 'DRIVER',
      points: 2,
      reason: 'SOME_SERIOUS',
      severity: 'SERIOUS',
      sourceType: 'REPORT',
      sourceId: 's1',
    });

    expect(strikeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ points: 2 }) }),
    );
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('suspends when active points reach 3 within 90 days', async () => {
    strikeAggregate.mockResolvedValue({ _sum: { points: 3 } });

    const res = await service.addStrike({
      userId: 'u1',
      role: 'DRIVER',
      points: 1,
      reason: 'X',
      severity: 'LIGHT',
      sourceType: 'DELIVERY',
      deliveryId: 'd1',
    });

    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1', isSuspended: false },
        data: expect.objectContaining({ isSuspended: true }),
      }),
    );
    expect(res.suspended).toBe(true);
  });

  it('only counts strikes within the 90-day window', async () => {
    await service.getActiveStrikePoints('u1', 'SELLER');

    const call = strikeAggregate.mock.calls[0][0];
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    // The cutoff is ~90 days ago.
    const ageMs = Date.now() - (call.where.createdAt.gte as Date).getTime();
    expect(ageMs).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
  });

  it('does not create a duplicate strike for the same source', async () => {
    strikeFindFirst.mockResolvedValue({ id: 'existing' });

    const res = await service.addStrike({
      userId: 'u1',
      role: 'SELLER',
      points: 1,
      reason: 'SELLER_UNAVAILABLE',
      severity: 'LIGHT',
      sourceType: 'DELIVERY',
      deliveryId: 'd1',
    });

    expect(res.created).toBe(false);
    expect(strikeCreate).not.toHaveBeenCalled();
  });

  it('immediateExclude records a CRITICAL strike and force-suspends', async () => {
    strikeAggregate.mockResolvedValue({ _sum: { points: 3 } });

    await service.immediateExclude('driver-1', 'DRIVER', 'DRIVER_DISAPPEARED_AFTER_PICKUP', {
      sourceType: 'DELIVERY',
      deliveryId: 'd1',
      orderId: 'o1',
    });

    expect(strikeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ severity: 'CRITICAL', points: 3 }),
      }),
    );
    expect(userUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isSuspended: true }) }),
    );
  });
});
