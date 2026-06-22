import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * Order guard: a buyer cannot create an order from a suspended seller, even via
 * a cached/deep-linked listing that bypassed the feed filter. Exercised through
 * the cart validation that every order placement runs. Prisma is mocked.
 */
describe('OrdersService — block orders from suspended sellers', () => {
  let listingFindMany: ReturnType<typeof vi.fn>;
  let sellerProfileFindUnique: ReturnType<typeof vi.fn>;
  let service: OrdersService;

  beforeEach(() => {
    listingFindMany = vi.fn().mockResolvedValue([
      {
        id: 'l1',
        sellerId: 'seller-1',
        name: 'Dish',
        priceCents: 1000,
        portionsLeft: null,
        isAvailable: true,
        expiresAt: null,
        fulfillment: 'DELIVERY',
        deletedAt: null,
      },
    ]);
    sellerProfileFindUnique = vi.fn();

    const prisma = {
      db: {
        listing: { findMany: listingFindMany },
        sellerProfile: { findUnique: sellerProfileFindUnique },
      },
    } as unknown as PrismaService;

    service = new OrdersService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  // loadAndValidateCart runs on every order placement, before payment/order creation.
  function loadCart(items: Array<{ listingId: string; quantity: number }>): Promise<unknown> {
    return (
      service as unknown as {
        loadAndValidateCart: (i: unknown) => Promise<unknown>;
      }
    ).loadAndValidateCart(items);
  }

  it('rejects an order when the seller is suspended', async () => {
    sellerProfileFindUnique.mockResolvedValue({
      kycStatus: 'APPROVED',
      user: { deletedAt: null, isSuspended: true },
    });

    await expect(loadCart([{ listingId: 'l1', quantity: 1 }])).rejects.toThrowError(
      'Ce vendeur est actuellement suspendu.',
    );
  });

  it('does not reject at the suspension gate for a non-suspended seller', async () => {
    // Non-suspended → passes the suspension check; fails later on the
    // subscription gate, proving the suspension gate let it through.
    sellerProfileFindUnique.mockResolvedValue({
      kycStatus: 'APPROVED',
      user: { deletedAt: null, isSuspended: false },
      subscriptionStatus: 'INACTIVE',
      subscriptionCurrentPeriodEnd: null,
      deliveryFeeCents: 100,
    });

    await expect(loadCart([{ listingId: 'l1', quantity: 1 }])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(loadCart([{ listingId: 'l1', quantity: 1 }])).rejects.not.toThrowError(
      'Ce vendeur est actuellement suspendu.',
    );
  });
});
