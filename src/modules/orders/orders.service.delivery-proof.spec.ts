import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * Delivery-proof access: the order's buyer or seller can read it; any other
 * user is forbidden. Surfaces the client-absent photo/GPS/timestamp. Prisma is
 * mocked — no DB.
 */
describe('OrdersService — delivery proof', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let service: OrdersService;

  beforeEach(() => {
    userFindUnique = vi.fn();
    orderFindUnique = vi.fn();
    const prisma = {
      db: {
        user: { findUnique: userFindUnique },
        order: { findUnique: orderFindUnique },
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
      { enqueue: async () => {} } as never,
    );
  });

  function absentDeliveredOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: 'o1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      deliveries: [
        {
          id: 'd1',
          status: 'DELIVERED',
          deliveredAt: new Date('2026-06-19T10:00:00Z'),
          deliveredAsAbsent: true,
          absentProofPhotoUrl: 'avatars/driver-1/abc',
          absentProofLat: 48.85,
          absentProofLng: 2.35,
          absentProofTakenAt: new Date('2026-06-19T10:00:00Z'),
          absentProofNote: 'Déposé devant la porte',
          absentProofContactAttemptedAt: null,
        },
      ],
      ...overrides,
    };
  }

  it('returns the absent proof for the order buyer', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue(absentDeliveredOrder());

    const res = await service.getOrderDeliveryProof('sub-buyer', 'o1');

    expect(res.deliveredAsAbsent).toBe(true);
    expect(res.photoUrl).toBe('avatars/driver-1/abc');
    expect(res.lat).toBe(48.85);
    expect(res.deliveredAt).toContain('2026-06-19');
  });

  it('returns the proof for the order seller too', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-1' });
    orderFindUnique.mockResolvedValue(absentDeliveredOrder());

    const res = await service.getOrderDeliveryProof('sub-seller', 'o1');
    expect(res.deliveryId).toBe('d1');
  });

  it('forbids a user who is neither buyer nor seller', async () => {
    userFindUnique.mockResolvedValue({ id: 'other-1' });
    orderFindUnique.mockResolvedValue(absentDeliveredOrder());

    await expect(service.getOrderDeliveryProof('sub-other', 'o1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s when the order has no delivery', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue(absentDeliveredOrder({ deliveries: [] }));

    await expect(service.getOrderDeliveryProof('sub-buyer', 'o1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
