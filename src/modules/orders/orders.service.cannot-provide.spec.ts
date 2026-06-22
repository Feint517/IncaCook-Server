import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * Seller "Je ne peux pas fournir": before pickup, the seller cancels — buyer
 * refunded, inventory restored, delivery cancelled, seller pending reversed +
 * a LIGHT strike. Prisma + Stripe + strikes + notifications mocked.
 */
describe('OrdersService — seller cannot provide', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let orderUpdate: ReturnType<typeof vi.fn>;
  let deliveryUpdate: ReturnType<typeof vi.fn>;
  let execRaw: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let walletUpdateMany: ReturnType<typeof vi.fn>;
  let refundsCreate: ReturnType<typeof vi.fn>;
  let auditRecord: ReturnType<typeof vi.fn>;
  let addStrike: ReturnType<typeof vi.fn>;
  let sendToUsers: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let service: OrdersService;

  function order(overrides: Record<string, unknown> = {}) {
    return {
      id: 'o1',
      status: 'READY',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      inventoryRestored: false,
      items: [{ listingId: 'l1', quantity: 2 }],
      deliveries: [
        { id: 'd1', status: 'SEARCHING', pickupConfirmedAt: null, driverId: 'driver-1' },
      ],
      // refundOrderIfNeeded + findOrderWithRelations fields:
      stripePaymentIntentId: 'pi_1',
      stripeRefundId: null,
      buyerTotalCents: 1500,
      dropoffAddress: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    userFindUnique = vi.fn().mockResolvedValue({ id: 'seller-1' }); // assertSellerUser
    orderFindUnique = vi.fn().mockResolvedValue(order());
    orderUpdate = vi.fn().mockResolvedValue({});
    deliveryUpdate = vi.fn().mockResolvedValue({});
    execRaw = vi.fn().mockResolvedValue(undefined);
    transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        order: { update: orderUpdate },
        delivery: { update: deliveryUpdate },
        $executeRaw: execRaw,
      }),
    );
    walletUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    refundsCreate = vi.fn().mockResolvedValue({ id: 're_1' });
    auditRecord = vi.fn().mockResolvedValue(undefined);
    addStrike = vi.fn().mockResolvedValue({ created: true, suspended: false });
    sendToUsers = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      $transaction: transaction,
      db: {
        user: { findUnique: userFindUnique },
        order: { findUnique: orderFindUnique, update: orderUpdate },
        delivery: { update: deliveryUpdate },
        walletEntry: { updateMany: walletUpdateMany },
      },
    } as unknown as PrismaService;

    const stripe = { client: { refunds: { create: refundsCreate } } } as never;
    service = new OrdersService(
      prisma,
      stripe,
      { record: auditRecord } as never,
      {} as never,
      { sendToUsers } as never,
      {} as never,
      {} as never,
      { addStrike } as never,
    );
    vi.spyOn(service, 'publishOrderStatusChanged').mockImplementation(publish);
  });

  it('lets the seller cancel their own order before pickup', async () => {
    await service.sellerCannotProvide('sub-seller', 'o1', {});

    // Order cancelled + inventory restored + delivery cancelled.
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationReason: 'seller_cannot_provide',
        }),
      }),
    );
    expect(execRaw).toHaveBeenCalled(); // inventory restored
    expect(deliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    // Buyer refunded + seller pending reversed (not paid).
    expect(refundsCreate).toHaveBeenCalled();
    expect(walletUpdateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    // Seller LIGHT strike.
    expect(addStrike).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        role: 'SELLER',
        reason: 'SELLER_CANNOT_PROVIDE',
        points: 1,
        severity: 'LIGHT',
      }),
    );
    // Notifications: buyer + seller + driver.
    expect(sendToUsers).toHaveBeenCalledWith(['buyer-1'], expect.objectContaining({}));
    expect(sendToUsers).toHaveBeenCalledWith(['seller-1'], expect.objectContaining({}));
    expect(sendToUsers).toHaveBeenCalledWith(['driver-1'], expect.objectContaining({}));
  });

  it('forbids another seller from cancelling the order', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-2' });
    await expect(service.sellerCannotProvide('sub-other', 'o1', {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('rejects cancellation after pickup is confirmed', async () => {
    orderFindUnique.mockResolvedValue(
      order({
        deliveries: [
          { id: 'd1', status: 'PICKED_UP', pickupConfirmedAt: new Date(), driverId: 'driver-1' },
        ],
      }),
    );
    await expect(service.sellerCannotProvide('sub-seller', 'o1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('rejects a duplicate cancellation (already resolved) — no double refund', async () => {
    orderFindUnique.mockResolvedValue(order({ status: 'CANCELLED' }));
    await expect(service.sellerCannotProvide('sub-seller', 'o1', {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(addStrike).not.toHaveBeenCalled();
  });

  it('rejects cancellation from an invalid (unpaid) state', async () => {
    orderFindUnique.mockResolvedValue(order({ status: 'PENDING' }));
    await expect(service.sellerCannotProvide('sub-seller', 'o1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
