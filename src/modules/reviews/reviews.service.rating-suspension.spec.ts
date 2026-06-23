import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { ReviewsService } from './reviews.service';

/**
 * Rating-based seller suspension: a seller with >= 10 reviews whose average
 * drops below 3.5/5 is suspended via the existing StrikesService. Idempotent.
 * Prisma + StrikesService are mocked.
 */
describe('ReviewsService — rating-based suspension', () => {
  let reviewAggregate: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;
  let suspendUser: ReturnType<typeof vi.fn>;
  let service: ReviewsService;

  beforeEach(() => {
    reviewAggregate = vi.fn();
    userFindUnique = vi.fn().mockResolvedValue({ isSuspended: false });
    suspendUser = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      db: {
        review: { aggregate: reviewAggregate },
        user: { findUnique: userFindUnique },
      },
    } as unknown as PrismaService;

    service = new ReviewsService(prisma, { suspendUser } as never);
  });

  function ratings(count: number, average: number) {
    reviewAggregate.mockResolvedValue({ _avg: { rating: average }, _count: { _all: count } });
  }

  it('does not suspend with fewer than 10 reviews (even below 3.5)', async () => {
    ratings(9, 2.0);
    await service.evaluateSellerRatingSuspension('seller-1');
    expect(suspendUser).not.toHaveBeenCalled();
  });

  it('does not suspend at exactly 3.5 with 10 reviews', async () => {
    ratings(10, 3.5);
    await service.evaluateSellerRatingSuspension('seller-1');
    expect(suspendUser).not.toHaveBeenCalled();
  });

  it('suspends at 3.49 with 10 reviews', async () => {
    ratings(10, 3.49);
    await service.evaluateSellerRatingSuspension('seller-1');
    expect(suspendUser).toHaveBeenCalledWith(
      'seller-1',
      'SELLER',
      expect.stringContaining('3,5'),
      expect.objectContaining({ message: expect.stringContaining('3,5') }),
    );
  });

  it('does not suspend when the average is above the threshold', async () => {
    ratings(20, 4.6);
    await service.evaluateSellerRatingSuspension('seller-1');
    expect(suspendUser).not.toHaveBeenCalled();
  });

  it('is idempotent: an already-suspended seller is not re-suspended', async () => {
    ratings(10, 2.0);
    userFindUnique.mockResolvedValue({ isSuspended: true });
    await service.evaluateSellerRatingSuspension('seller-1');
    expect(suspendUser).not.toHaveBeenCalled();
  });
});
