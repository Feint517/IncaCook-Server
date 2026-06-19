import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * Driver-disappeared-after-pickup detection: if the driver confirmed pickup but
 * never delivered, the buyer is refunded, the seller is paid (the dish left the
 * seller), and the driver is not paid — with an exclusion hook for later. The
 * detection is idempotent and skips when the delivery was actually completed.
 */
describe('OrdersService — driver disappeared after pickup', () => {
  let deliveryFindUnique: ReturnType<typeof vi.fn>;
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let deliveryUpdate: ReturnType<typeof vi.fn>;
  let orderUpdate: ReturnType<typeof vi.fn>;
  let execRaw: ReturnType<typeof vi.fn>;
  let walletUpdateMany: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let queryRaw: ReturnType<typeof vi.fn>;
  let refundsCreate: ReturnType<typeof vi.fn>;
  let auditRecord: ReturnType<typeof vi.fn>;
  let creditSellerEarning: ReturnType<typeof vi.fn>;
  let sendToUsers: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let immediateExclude: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let service: OrdersService;

  function delivery(overrides: Record<string, unknown> = {}) {
    return {
      id: 'd1',
      orderId: 'o1',
      status: 'PICKED_UP',
      driverId: 'driver-1',
      pickupConfirmedAt: new Date('2026-06-19T09:00:00Z'),
      deliveredConfirmedAt: null,
      deliveredAsAbsent: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    deliveryFindUnique = vi.fn();
    deliveryUpdate = vi.fn().mockResolvedValue({});
    orderUpdate = vi.fn().mockResolvedValue({});
    execRaw = vi.fn().mockResolvedValue(undefined);
    walletUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        delivery: { update: deliveryUpdate },
        order: { update: orderUpdate },
        $executeRaw: execRaw,
      }),
    );
    queryRaw = vi.fn().mockResolvedValue([{ stale: true, far: true }]);
    refundsCreate = vi.fn().mockResolvedValue({ id: 're_1' });
    auditRecord = vi.fn().mockResolvedValue(undefined);
    creditSellerEarning = vi.fn().mockResolvedValue(undefined);
    sendToUsers = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn().mockResolvedValue(undefined);
    immediateExclude = vi.fn().mockResolvedValue(undefined);

    orderFindUnique = vi.fn().mockResolvedValue({
      id: 'o1',
      status: 'IN_DELIVERY',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      sellerEarningsCents: 1000,
      stripePaymentIntentId: 'pi_1',
      stripeRefundId: null,
      buyerTotalCents: 1500,
    });

    const prisma = {
      $transaction: transaction,
      $queryRaw: queryRaw,
      db: {
        delivery: { findUnique: deliveryFindUnique, update: deliveryUpdate },
        order: { findUnique: orderFindUnique, update: orderUpdate },
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
      { creditSellerEarning } as never,
      {} as never,
      { immediateExclude } as never,
    );
    vi.spyOn(service, 'publishOrderStatusChanged').mockImplementation(publish);
    logSpy = vi.spyOn(Logger.prototype, 'log');
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('skips when the delivery was confirmed by the buyer QR', async () => {
    deliveryFindUnique.mockResolvedValue(
      delivery({ status: 'DELIVERED', deliveredConfirmedAt: new Date() }),
    );

    await service.handleDriverDeliveryTimeout('d1');

    expect(transaction).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(creditSellerEarning).not.toHaveBeenCalled();
  });

  it('skips when an absent-dropoff proof exists', async () => {
    deliveryFindUnique.mockResolvedValue(delivery({ deliveredAsAbsent: true }));

    await service.handleDriverDeliveryTimeout('d1');

    expect(transaction).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(creditSellerEarning).not.toHaveBeenCalled();
  });

  it('detects pickup-without-delivery → refunds buyer, pays seller, fails delivery', async () => {
    deliveryFindUnique.mockResolvedValue(delivery());

    await service.handleDriverDeliveryTimeout('d1');

    // Delivery FAILED + order CANCELLED.
    expect(deliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({ status: 'FAILED', failureReason: 'driver_disappeared' }),
      }),
    );
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationReason: 'driver_disappeared',
        }),
      }),
    );
    // Buyer refunded.
    expect(refundsCreate).toHaveBeenCalled();
    // Seller paid (dish left the seller).
    expect(creditSellerEarning).toHaveBeenCalledWith('o1', 'seller-1', 1000);
    // Inventory NOT restored — the dish already left the seller.
    expect(execRaw).not.toHaveBeenCalled();
    // Buyer + seller + driver notified.
    expect(sendToUsers).toHaveBeenCalledWith(['buyer-1'], expect.objectContaining({}));
    expect(sendToUsers).toHaveBeenCalledWith(['seller-1'], expect.objectContaining({}));
  });

  it('reverses any driver pending earning and never creates a new one', async () => {
    deliveryFindUnique.mockResolvedValue(delivery());

    await service.handleDriverDeliveryTimeout('d1');

    // Any PENDING driver earning is reversed to CANCELLED.
    expect(walletUpdateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', type: 'DELIVERY_EARNING', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    // No driver delivery-earning is credited (only the seller is paid).
    expect(creditSellerEarning).toHaveBeenCalledTimes(1);
  });

  it('immediately excludes the driver (strike hook)', async () => {
    deliveryFindUnique.mockResolvedValue(delivery());

    await service.handleDriverDeliveryTimeout('d1');

    expect(immediateExclude).toHaveBeenCalledWith(
      'driver-1',
      'DRIVER',
      'DRIVER_DISAPPEARED_AFTER_PICKUP',
      expect.objectContaining({ sourceType: 'DELIVERY', deliveryId: 'd1', orderId: 'o1' }),
    );
  });

  it('is idempotent: a second run on an already-failed delivery does nothing', async () => {
    deliveryFindUnique.mockResolvedValue(delivery({ status: 'FAILED' }));

    await service.handleDriverDeliveryTimeout('d1');

    expect(transaction).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(creditSellerEarning).not.toHaveBeenCalled();
  });
});
