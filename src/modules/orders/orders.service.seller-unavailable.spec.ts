import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * Money side of the seller-unavailable flow: cancel + restore inventory, refund
 * the buyer + reverse any seller pending earnings (seller not paid), and
 * compensate the driver for the trip. Prisma + Stripe + wallet + notifications
 * are mocked.
 */
describe('OrdersService — cancelForSellerUnavailable', () => {
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let orderUpdate: ReturnType<typeof vi.fn>;
  let execRaw: ReturnType<typeof vi.fn>;
  let walletUpdateMany: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let refundsCreate: ReturnType<typeof vi.fn>;
  let auditRecord: ReturnType<typeof vi.fn>;
  let compensateDriver: ReturnType<typeof vi.fn>;
  let sendToUsers: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let addStrike: ReturnType<typeof vi.fn>;
  let service: OrdersService;

  beforeEach(() => {
    orderUpdate = vi.fn().mockResolvedValue({});
    execRaw = vi.fn().mockResolvedValue(undefined);
    walletUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({ order: { update: orderUpdate }, $executeRaw: execRaw }),
    );
    refundsCreate = vi.fn().mockResolvedValue({ id: 're_1' });
    auditRecord = vi.fn().mockResolvedValue(undefined);
    compensateDriver = vi.fn().mockResolvedValue(undefined);
    sendToUsers = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn().mockResolvedValue(undefined);
    addStrike = vi.fn().mockResolvedValue({ created: true, suspended: false });

    orderFindUnique = vi.fn().mockResolvedValue({
      id: 'o1',
      status: 'READY',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      fulfillmentFeeCents: 400,
      inventoryRestored: false,
      items: [{ listingId: 'l1', quantity: 2 }],
      // refundOrderIfNeeded fields:
      stripePaymentIntentId: 'pi_1',
      stripeRefundId: null,
      buyerTotalCents: 1500,
    });

    const prisma = {
      $transaction: transaction,
      db: {
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
      { compensateDriver } as never,
      {} as never,
      { addStrike } as never,
      { enqueue: async () => {} } as never,
    );
    vi.spyOn(service, 'publishOrderStatusChanged').mockImplementation(publish);
  });

  it('cancels + refunds the buyer, compensates the driver, restores inventory', async () => {
    await service.cancelForSellerUnavailable('o1', 'driver-1');

    // Order cancelled.
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancellationReason: 'seller_unavailable',
        }),
      }),
    );
    // Inventory restored (portionsLeft += qty).
    expect(execRaw).toHaveBeenCalled();
    // Buyer refunded via Stripe.
    expect(refundsCreate).toHaveBeenCalled();
    // Seller pending earnings reversed (seller not paid).
    expect(walletUpdateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    // Driver compensated for the trip (delivery fee).
    expect(compensateDriver).toHaveBeenCalledWith('o1', 'driver-1', 400);
    // Buyer + seller notified.
    expect(sendToUsers).toHaveBeenCalledWith(['buyer-1'], expect.objectContaining({}));
    expect(sendToUsers).toHaveBeenCalledWith(['seller-1'], expect.objectContaining({}));
    // Seller receives a light strike.
    expect(addStrike).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        role: 'SELLER',
        reason: 'SELLER_UNAVAILABLE',
        severity: 'LIGHT',
        points: 1,
      }),
    );
  });

  it('rejects when the order is already resolved', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      status: 'CANCELLED',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      fulfillmentFeeCents: 400,
      inventoryRestored: true,
      items: [],
    });

    await expect(service.cancelForSellerUnavailable('o1', 'driver-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(compensateDriver).not.toHaveBeenCalled();
  });
});
