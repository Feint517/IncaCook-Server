import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { ListingsService } from './listings.service';

/**
 * Suspended-seller hardening: a suspended seller is hidden from the buyer feed
 * + listing detail + kitchens, and cannot publish — but can still see their own
 * listings. Prisma is mocked; the feed is raw SQL so we assert the suspension
 * filter is present in the generated query.
 */
describe('ListingsService — suspended seller visibility', () => {
  let listingFindUnique: ReturnType<typeof vi.fn>;
  let listingFindMany: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;
  let queryRaw: ReturnType<typeof vi.fn>;
  let service: ListingsService;

  beforeEach(() => {
    listingFindUnique = vi.fn();
    listingFindMany = vi.fn();
    userFindUnique = vi.fn();
    queryRaw = vi.fn().mockResolvedValue([]);

    const prisma = {
      $queryRaw: queryRaw,
      db: {
        listing: { findUnique: listingFindUnique, findMany: listingFindMany },
        user: { findUnique: userFindUnique },
      },
    } as unknown as PrismaService;

    service = new ListingsService(prisma);
  });

  // --- Buyer-facing detail ------------------------------------------------

  it('hides a suspended seller listing from the buyer detail (404)', async () => {
    listingFindUnique.mockResolvedValue({ id: 'l1', deletedAt: null, sellerId: 'seller-1' });
    userFindUnique.mockResolvedValue({ isSuspended: true });

    await expect(service.findById('l1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a non-suspended seller listing from the buyer detail', async () => {
    const listing = { id: 'l1', deletedAt: null, sellerId: 'seller-1', addOns: [], seller: {} };
    listingFindUnique.mockResolvedValue(listing);
    userFindUnique.mockResolvedValue({ isSuspended: false });

    const res = await service.findById('l1');
    expect(res.id).toBe('l1');
  });

  // --- Buyer-facing feed (raw SQL) ----------------------------------------

  it('applies the suspended-seller filter in the feed query', async () => {
    // lat/lng provided so resolveBuyerPoint short-circuits (no DB).
    await service.feed('sub-buyer', { lat: 48.8, lng: 2.3 } as never);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    // The `u."isSuspended" = false` condition is interpolated as a Prisma.Sql
    // value; JSON-serializing the call args surfaces its literal fragments.
    const serialized = JSON.stringify(queryRaw.mock.calls[0]);
    expect(serialized).toContain('isSuspended');
  });

  // --- Seller's own dashboard (NOT filtered) ------------------------------

  it('lets a suspended seller still see their own listings', async () => {
    userFindUnique.mockResolvedValue({
      id: 'seller-1',
      role: 'SELLER',
      isSuspended: true,
      sellerProfile: { userId: 'seller-1' },
    });
    listingFindMany.mockResolvedValue([{ id: 'l1', addOns: [] }]);

    const res = await service.findMine('sub-seller');
    expect(res).toHaveLength(1);
  });

  // --- Publish block (prior feature, re-verified) -------------------------

  it('blocks a suspended seller from publishing a new listing', async () => {
    userFindUnique.mockResolvedValue({
      id: 'seller-1',
      role: 'SELLER',
      isSuspended: true,
      sellerProfile: {
        userId: 'seller-1',
        kycStatus: 'APPROVED',
        subscriptionStatus: 'ACTIVE',
        subscriptionCurrentPeriodEnd: new Date('2099-01-01T00:00:00Z'),
      },
    });

    await expect(service.create('sub-seller', {} as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
