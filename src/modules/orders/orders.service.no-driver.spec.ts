import { ConflictException, ForbiddenException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * No-driver-available fallback: the timeout flips a still-searching order to
 * NO_DRIVER_AVAILABLE and prompts the buyer; the buyer can switch to pickup or
 * cancel+refund; a no-response auto-cancels. The seller is never penalised.
 * Prisma + collaborators are mocked.
 */
describe('OrdersService — no-driver fallback', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let orderUpdate: ReturnType<typeof vi.fn>;
  let deliveryUpdate: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let execRaw: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let sendToUsers: ReturnType<typeof vi.fn>;
  let refundsCreate: ReturnType<typeof vi.fn>;
  let auditRecord: ReturnType<typeof vi.fn>;
  let addTimeout: ReturnType<typeof vi.fn>;
  let deleteTimeout: ReturnType<typeof vi.fn>;
  let service: OrdersService;

  beforeEach(() => {
    // Fake timers so the watchdog setTimeout calls don't keep the process alive.
    vi.useFakeTimers();
    userFindUnique = vi.fn();
    orderFindUnique = vi.fn();
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
    publish = vi.fn().mockResolvedValue(undefined);
    sendToUsers = vi.fn().mockResolvedValue(undefined);
    refundsCreate = vi.fn().mockResolvedValue({ id: 're_1' });
    auditRecord = vi.fn().mockResolvedValue(undefined);
    addTimeout = vi.fn();
    deleteTimeout = vi.fn();

    const prisma = {
      $transaction: transaction,
      db: {
        user: { findUnique: userFindUnique },
        order: { findUnique: orderFindUnique, update: orderUpdate },
        delivery: { update: deliveryUpdate },
        // Refund path reverses any PENDING wallet entries (wallet 24h safety).
        walletEntry: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      },
    } as unknown as PrismaService;

    const stripe = { client: { refunds: { create: refundsCreate } } } as never;
    const scheduler = {
      addTimeout,
      deleteTimeout,
      doesExist: vi.fn().mockReturnValue(true),
    } as never;

    service = new OrdersService(
      prisma,
      stripe,
      { record: auditRecord } as never,
      {} as never,
      { sendToUsers } as never,
      {} as never,
      scheduler,
      {} as never,
      { enqueue: async () => {} } as never,
    );
    // publishOrderStatusChanged uses redis; stub it to avoid the null redis dep.
    vi.spyOn(service, 'publishOrderStatusChanged').mockImplementation(publish);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing if a driver already claimed the delivery', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      status: 'READY',
      buyerId: 'buyer-1',
      fulfillmentChoice: 'DELIVERY',
      deliveries: [{ id: 'd1', status: 'ASSIGNED', driverId: 'driver-1' }],
    });

    await service.handleNoDriverTimeout('o1');

    expect(orderUpdate).not.toHaveBeenCalled();
    expect(sendToUsers).not.toHaveBeenCalled();
  });

  it('flips to NO_DRIVER_AVAILABLE and prompts the buyer when no driver claimed', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      status: 'READY',
      buyerId: 'buyer-1',
      fulfillmentChoice: 'DELIVERY',
      deliveries: [{ id: 'd1', status: 'SEARCHING', driverId: null }],
    });

    await service.handleNoDriverTimeout('o1');

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: 'NO_DRIVER_AVAILABLE' },
    });
    expect(sendToUsers).toHaveBeenCalledWith(['buyer-1'], expect.objectContaining({}));
    // Buyer-response auto-cancel watchdog armed.
    expect(addTimeout).toHaveBeenCalled();
  });

  it('lets the buyer switch to pickup (no refund)', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      status: 'NO_DRIVER_AVAILABLE',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      deliveries: [{ id: 'd1' }],
      // findOrderWithRelations shape:
      items: [],
      dropoffAddress: null,
    });

    await service.decideNoDriver('sub-buyer', 'o1', 'SWITCH_TO_PICKUP');

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: 'READY', fulfillmentChoice: 'PICKUP' },
    });
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(deleteTimeout).toHaveBeenCalled(); // response watchdog cancelled
  });

  it('lets the buyer cancel and refund', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      status: 'NO_DRIVER_AVAILABLE',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      inventoryRestored: false,
      items: [],
      dropoffAddress: null,
      deliveries: [{ id: 'd1' }],
      stripePaymentIntentId: 'pi_1',
      stripeRefundId: null,
      buyerTotalCents: 1200,
    });

    await service.decideNoDriver('sub-buyer', 'o1', 'CANCEL_AND_REFUND');

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'o1' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(refundsCreate).toHaveBeenCalled();
    // Seller notified with the no-fault message (not penalised).
    expect(sendToUsers).toHaveBeenCalledWith(['seller-1'], expect.objectContaining({}));
  });

  it('forbids a non-buyer (e.g. seller) from deciding', async () => {
    userFindUnique.mockResolvedValue({ id: 'seller-1' });
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      status: 'NO_DRIVER_AVAILABLE',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      deliveries: [{ id: 'd1' }],
    });

    await expect(
      service.decideNoDriver('sub-seller', 'o1', 'SWITCH_TO_PICKUP'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('rejects a decision when the order is not awaiting one', async () => {
    userFindUnique.mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique.mockResolvedValue({
      id: 'o1',
      status: 'READY',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      deliveries: [{ id: 'd1' }],
    });

    await expect(
      service.decideNoDriver('sub-buyer', 'o1', 'CANCEL_AND_REFUND'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('auto-cancels + refunds when the buyer never responds', async () => {
    orderFindUnique
      // autoCancelNoResponse status check:
      .mockResolvedValueOnce({ status: 'NO_DRIVER_AVAILABLE' })
      // cancelNoDriverOrder load:
      .mockResolvedValueOnce({
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        inventoryRestored: true,
        items: [],
        deliveries: [{ id: 'd1' }],
      })
      // refundOrderIfNeeded load:
      .mockResolvedValueOnce({
        stripePaymentIntentId: 'pi_1',
        stripeRefundId: null,
        buyerTotalCents: 1200,
      });

    await service.autoCancelNoResponse('o1');

    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    expect(refundsCreate).toHaveBeenCalled();
  });

  it('does not auto-cancel if the buyer already resolved', async () => {
    orderFindUnique.mockResolvedValueOnce({ status: 'READY' });

    await service.autoCancelNoResponse('o1');

    expect(orderUpdate).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});
