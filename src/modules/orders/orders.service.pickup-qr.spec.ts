import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * Seller pickup-QR access: only the order's own seller can fetch it, a missing
 * token is lazily minted, and the order must be READY (a Delivery exists).
 * Prisma is mocked — no DB.
 */
describe('OrdersService — seller pickup QR', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let deliveryUpdate: ReturnType<typeof vi.fn>;
  let service: OrdersService;

  beforeEach(() => {
    userFindUnique = vi.fn();
    orderFindUnique = vi.fn();
    deliveryUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      db: {
        user: { findUnique: userFindUnique }, // assertSellerUser
        order: { findUnique: orderFindUnique },
        delivery: { update: deliveryUpdate },
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

  it('returns the QR (token embedded) for the order owner', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-1' });
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      sellerId: 'seller-1',
      fulfillmentChoice: 'DELIVERY',
      deliveries: [{ id: 'd1', pickupToken: 'tok-12345678' }],
    });

    const res = await service.getSellerPickupQr('sub-seller', 'o1');

    expect(res.deliveryId).toBe('d1');
    expect(res.pickupToken).toBe('tok-12345678');
    expect(res.qrData).toContain('token=tok-12345678');
    expect(deliveryUpdate).not.toHaveBeenCalled();
  });

  it('forbids another seller from fetching the QR', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-2' });
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      sellerId: 'seller-1',
      fulfillmentChoice: 'DELIVERY',
      deliveries: [{ id: 'd1', pickupToken: 'tok' }],
    });

    await expect(service.getSellerPickupQr('sub-other', 'o1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lazily mints a token for a delivery created before this feature', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-1' });
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      sellerId: 'seller-1',
      fulfillmentChoice: 'DELIVERY',
      deliveries: [{ id: 'd1', pickupToken: null }],
    });

    const res = await service.getSellerPickupQr('sub-seller', 'o1');

    expect(deliveryUpdate).toHaveBeenCalledTimes(1);
    expect(res.pickupToken.length).toBeGreaterThan(10);
  });

  it('rejects when the order is not ready (no delivery yet)', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-1' });
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      sellerId: 'seller-1',
      fulfillmentChoice: 'DELIVERY',
      deliveries: [],
    });

    await expect(service.getSellerPickupQr('sub-seller', 'o1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
