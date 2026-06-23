import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { DeliveriesService } from './deliveries.service';

/**
 * Driver QR confirmations. Pickup (seller QR → PICKED_UP, order IN_DELIVERY)
 * and delivery (buyer QR → DELIVERED). Each covers: valid scan, invalid token,
 * wrong driver, and duplicate (idempotent — no second transition). Prisma +
 * collaborators are mocked.
 */
describe('DeliveriesService — confirm pickup + delivery (QR)', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let deliveryFindUnique: ReturnType<typeof vi.fn>;
  let deliveryUpdate: ReturnType<typeof vi.fn>;
  let orderUpdate: ReturnType<typeof vi.fn>;
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let publishStatus: ReturnType<typeof vi.fn>;
  let notify: ReturnType<typeof vi.fn>;
  let sendToUsers: ReturnType<typeof vi.fn>;
  let confirmDelivered: ReturnType<typeof vi.fn>;
  let cancelForSellerUnavailable: ReturnType<typeof vi.fn>;
  let publishDeliveryCancelledToDriver: ReturnType<typeof vi.fn>;
  let directDeliveryUpdate: ReturnType<typeof vi.fn>;
  let service: DeliveriesService;

  const driverUser = {
    id: 'driver-1',
    role: 'DRIVER',
    isSuspended: false,
    driverProfile: {
      userId: 'driver-1',
      kycStatus: 'APPROVED',
      stripeOnboardingCompleted: false,
      stripeConnectAccountId: null,
    },
  };

  function deliveryRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'd1',
      orderId: 'o1',
      status: DeliveryStatus.AT_PICKUP,
      driverId: 'driver-1',
      pickupToken: 'good-token',
      pickupConfirmedAt: null,
      deliveryToken: 'good-delivery-token',
      deliveredConfirmedAt: null,
      sellerUnavailableAt: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    userFindUnique = vi.fn().mockResolvedValue(driverUser);
    deliveryFindUnique = vi.fn();
    deliveryUpdate = vi.fn().mockResolvedValue({});
    directDeliveryUpdate = vi.fn().mockResolvedValue({});
    orderUpdate = vi.fn().mockResolvedValue({});
    transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({ delivery: { update: deliveryUpdate }, order: { update: orderUpdate } }),
    );
    publishStatus = vi.fn().mockResolvedValue(undefined);
    notify = vi.fn().mockResolvedValue(undefined);
    sendToUsers = vi.fn().mockResolvedValue(undefined);
    confirmDelivered = vi.fn().mockResolvedValue(undefined);
    orderFindUnique = vi
      .fn()
      .mockResolvedValue({ status: 'READY', buyerId: 'buyer-1', sellerId: 'seller-1' });
    cancelForSellerUnavailable = vi.fn().mockResolvedValue(undefined);
    publishDeliveryCancelledToDriver = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      $transaction: transaction,
      db: {
        user: { findUnique: userFindUnique },
        delivery: { findUnique: deliveryFindUnique, update: directDeliveryUpdate },
        order: { findUnique: orderFindUnique },
      },
    } as unknown as PrismaService;

    service = new DeliveriesService(
      prisma,
      {
        publishOrderStatusChanged: publishStatus,
        confirmDeliveredByDriver: confirmDelivered,
        cancelForSellerUnavailable,
        scheduleDriverDeliveryTimeout: vi.fn(),
        publishDeliveryCancelledToDriver,
      } as never,
      {} as never,
      {} as never,
      { notifyDeliveryEvent: notify, sendToUsers } as never,
      {} as never,
    );
  });

  // --- Pickup -------------------------------------------------------------

  it('confirms pickup with a valid token → PICKED_UP + order IN_DELIVERY', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow());

    await service.confirmPickup('sub-driver', 'd1', {
      pickupToken: 'good-token',
      lat: 48.8,
      lng: 2.3,
    });

    expect(deliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          status: DeliveryStatus.PICKED_UP,
          pickupConfirmedByDriverId: 'driver-1',
          pickupLat: 48.8,
          pickupLng: 2.3,
        }),
      }),
    );
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: 'IN_DELIVERY' },
    });
    expect(publishStatus).toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });

  it('rejects an invalid pickup token (QR code invalide) — no transition', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow());
    await expect(
      service.confirmPickup('sub-driver', 'd1', { pickupToken: 'WRONG' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a driver not assigned to the delivery (pickup)', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ driverId: 'other-driver' }));
    await expect(
      service.confirmPickup('sub-driver', 'd1', { pickupToken: 'good-token' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate pickup scan (already confirmed) — no second transition', async () => {
    deliveryFindUnique.mockResolvedValue(
      deliveryRow({ status: DeliveryStatus.PICKED_UP, pickupConfirmedAt: new Date() }),
    );
    await expect(
      service.confirmPickup('sub-driver', 'd1', { pickupToken: 'good-token' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction).not.toHaveBeenCalled();
  });

  // --- Delivery -----------------------------------------------------------

  it('confirms delivery with a valid token → DELIVERED', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ status: DeliveryStatus.PICKED_UP }));

    await service.confirmDelivery('sub-driver', 'd1', {
      deliveryToken: 'good-delivery-token',
      lat: 48.9,
      lng: 2.4,
    });

    expect(directDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          status: DeliveryStatus.DELIVERED,
          deliveredConfirmedByDriverId: 'driver-1',
          deliveredLat: 48.9,
          deliveredLng: 2.4,
        }),
      }),
    );
    expect(confirmDelivered).toHaveBeenCalledWith('o1');
    expect(notify).toHaveBeenCalled();
    expect(sendToUsers).toHaveBeenCalled();
  });

  it('rejects an invalid delivery token (QR code invalide) — no transition', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ status: DeliveryStatus.PICKED_UP }));
    await expect(
      service.confirmDelivery('sub-driver', 'd1', { deliveryToken: 'WRONG' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
    expect(confirmDelivered).not.toHaveBeenCalled();
  });

  it('rejects a driver not assigned to the delivery (delivery)', async () => {
    deliveryFindUnique.mockResolvedValue(
      deliveryRow({ status: DeliveryStatus.PICKED_UP, driverId: 'other-driver' }),
    );
    await expect(
      service.confirmDelivery('sub-driver', 'd1', { deliveryToken: 'good-delivery-token' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
  });

  it('rejects a duplicate delivery scan (already delivered) — no second transition', async () => {
    deliveryFindUnique.mockResolvedValue(
      deliveryRow({ status: DeliveryStatus.DELIVERED, deliveredConfirmedAt: new Date() }),
    );
    await expect(
      service.confirmDelivery('sub-driver', 'd1', { deliveryToken: 'good-delivery-token' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
    expect(confirmDelivered).not.toHaveBeenCalled();
  });

  // --- Absent dropoff (photo + GPS) ---------------------------------------

  it('confirms absent dropoff with photo + GPS → DELIVERED (as absent)', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ status: DeliveryStatus.PICKED_UP }));

    await service.confirmAbsentDropoff('sub-driver', 'd1', {
      photoUrl: 'avatars/driver-1/abc',
      lat: 48.85,
      lng: 2.35,
      note: 'Déposé devant la porte',
    });

    expect(directDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          status: DeliveryStatus.DELIVERED,
          deliveredAsAbsent: true,
          deliveredConfirmedByDriverId: 'driver-1',
          absentProofPhotoUrl: 'avatars/driver-1/abc',
          absentProofLat: 48.85,
          absentProofLng: 2.35,
        }),
      }),
    );
    expect(confirmDelivered).toHaveBeenCalledWith('o1');
    expect(sendToUsers).toHaveBeenCalled();
  });

  it('rejects absent dropoff without a photo', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ status: DeliveryStatus.PICKED_UP }));
    await expect(
      service.confirmAbsentDropoff('sub-driver', 'd1', { lat: 48.85, lng: 2.35 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
    expect(confirmDelivered).not.toHaveBeenCalled();
  });

  it('rejects absent dropoff without GPS', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ status: DeliveryStatus.PICKED_UP }));
    await expect(
      service.confirmAbsentDropoff('sub-driver', 'd1', { photoUrl: 'avatars/driver-1/abc' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
  });

  it('rejects absent dropoff by a driver not assigned to the delivery', async () => {
    deliveryFindUnique.mockResolvedValue(
      deliveryRow({ status: DeliveryStatus.PICKED_UP, driverId: 'other-driver' }),
    );
    await expect(
      service.confirmAbsentDropoff('sub-driver', 'd1', {
        photoUrl: 'avatars/driver-1/abc',
        lat: 48.85,
        lng: 2.35,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
  });

  it('rejects a duplicate absent dropoff (already delivered)', async () => {
    deliveryFindUnique.mockResolvedValue(
      deliveryRow({ status: DeliveryStatus.DELIVERED, deliveredConfirmedAt: new Date() }),
    );
    await expect(
      service.confirmAbsentDropoff('sub-driver', 'd1', {
        photoUrl: 'avatars/driver-1/abc',
        lat: 48.85,
        lng: 2.35,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
    expect(confirmDelivered).not.toHaveBeenCalled();
  });

  // --- Seller unavailable at pickup ---------------------------------------

  it('reports seller unavailable before pickup → cancels delivery + triggers order cancel', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ status: DeliveryStatus.AT_PICKUP }));

    await service.reportSellerUnavailable('sub-driver', 'd1', {
      reason: 'FOOD_NOT_AVAILABLE',
      lat: 48.85,
      lng: 2.35,
      note: 'Boutique fermée',
    });

    expect(directDeliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          status: DeliveryStatus.CANCELLED,
          sellerUnavailableReason: 'FOOD_NOT_AVAILABLE',
          sellerUnavailableLat: 48.85,
        }),
      }),
    );
    expect(cancelForSellerUnavailable).toHaveBeenCalledWith('o1', 'driver-1');
    // Driver acknowledgement push.
    expect(sendToUsers).toHaveBeenCalledWith(['driver-1'], expect.objectContaining({}));
    // Realtime cancel event to the assigned driver (auto-clear active job).
    expect(publishDeliveryCancelledToDriver).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({ deliveryId: 'd1', orderId: 'o1', status: 'CANCELLED' }),
    );
  });

  it('rejects a seller-unavailable report from a driver not assigned', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ driverId: 'other-driver' }));
    await expect(
      service.reportSellerUnavailable('sub-driver', 'd1', {
        reason: 'SELLER_ABSENT',
        lat: 48.85,
        lng: 2.35,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
    expect(cancelForSellerUnavailable).not.toHaveBeenCalled();
  });

  it('rejects a seller-unavailable report without GPS', async () => {
    deliveryFindUnique.mockResolvedValue(deliveryRow({ status: DeliveryStatus.AT_PICKUP }));
    await expect(
      service.reportSellerUnavailable('sub-driver', 'd1', { reason: 'SELLER_ABSENT' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
    expect(cancelForSellerUnavailable).not.toHaveBeenCalled();
  });

  it('rejects a seller-unavailable report after pickup was confirmed', async () => {
    deliveryFindUnique.mockResolvedValue(
      deliveryRow({ status: DeliveryStatus.PICKED_UP, pickupConfirmedAt: new Date() }),
    );
    await expect(
      service.reportSellerUnavailable('sub-driver', 'd1', {
        reason: 'SELLER_ABSENT',
        lat: 48.85,
        lng: 2.35,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
  });

  it('rejects a duplicate seller-unavailable report', async () => {
    deliveryFindUnique.mockResolvedValue(
      deliveryRow({ status: DeliveryStatus.CANCELLED, sellerUnavailableAt: new Date() }),
    );
    await expect(
      service.reportSellerUnavailable('sub-driver', 'd1', {
        reason: 'SELLER_ABSENT',
        lat: 48.85,
        lng: 2.35,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(directDeliveryUpdate).not.toHaveBeenCalled();
    expect(cancelForSellerUnavailable).not.toHaveBeenCalled();
  });

  // --- Suspension blocking -------------------------------------------------

  it('blocks a suspended driver from going online', async () => {
    userFindUnique.mockResolvedValue({ ...driverUser, isSuspended: true });
    await expect(service.setOnline('sub-driver', { isOnline: true })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks a suspended driver from claiming a delivery', async () => {
    userFindUnique.mockResolvedValue({ ...driverUser, isSuspended: true });
    await expect(service.claim('sub-driver', 'd1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
