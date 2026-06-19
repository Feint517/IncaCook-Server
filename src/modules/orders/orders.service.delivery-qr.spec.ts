import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * Buyer delivery-QR access: only the order's own buyer can fetch it, the order
 * must be IN_DELIVERY with pickup confirmed, and a missing token is lazily
 * minted. Prisma is mocked — no DB.
 */
describe('OrdersService — buyer delivery QR', () => {
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
        user: { findUnique: userFindUnique },
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

  function pickedUpOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'o1',
      buyerId: 'buyer-1',
      status: 'IN_DELIVERY',
      deliveries: [
        {
          id: 'd1',
          driverId: 'driver-1',
          pickupConfirmedAt: new Date(),
          deliveryToken: 'tok-12345678',
        },
      ],
      ...overrides,
    };
  }

  it('returns the QR (token embedded) for the order owner when IN_DELIVERY', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue(pickedUpOrder());

    const res = await service.getBuyerDeliveryQr('sub-buyer', 'o1');

    expect(res.deliveryId).toBe('d1');
    expect(res.deliveryToken).toBe('tok-12345678');
    expect(res.qrData).toContain('token=tok-12345678');
    expect(res.qrData).toContain('incacook://delivery');
    expect(deliveryUpdate).not.toHaveBeenCalled();
  });

  it('forbids another buyer from fetching the QR', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-2' });
    orderFindUnique.mockResolvedValue(pickedUpOrder());

    await expect(service.getBuyerDeliveryQr('sub-other', 'o1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('forbids a non-buyer (e.g. the seller) from fetching the buyer QR', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-1' });
    orderFindUnique.mockResolvedValue(pickedUpOrder());

    await expect(service.getBuyerDeliveryQr('sub-seller', 'o1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects when the order is not in delivery', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue(pickedUpOrder({ status: 'PREPARING' }));

    await expect(service.getBuyerDeliveryQr('sub-buyer', 'o1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when pickup has not been confirmed yet', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue(
      pickedUpOrder({
        deliveries: [
          { id: 'd1', driverId: 'driver-1', pickupConfirmedAt: null, deliveryToken: null },
        ],
      }),
    );

    await expect(service.getBuyerDeliveryQr('sub-buyer', 'o1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lazily mints a token for an in-flight delivery without one', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue(
      pickedUpOrder({
        deliveries: [
          { id: 'd1', driverId: 'driver-1', pickupConfirmedAt: new Date(), deliveryToken: null },
        ],
      }),
    );

    const res = await service.getBuyerDeliveryQr('sub-buyer', 'o1');

    expect(deliveryUpdate).toHaveBeenCalledTimes(1);
    expect(res.deliveryToken.length).toBeGreaterThan(10);
  });
});
