import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from './orders.service';

/**
 * Buyer post-delivery disputes: auto-refund the allowed cases (proven-undelivered
 * never-received, wrong order), route sensitive cases to admin review, reject
 * subjective dissatisfaction, and let admins approve/reject/resolve. Refund is
 * idempotent. Prisma + Stripe + strikes + notifications are mocked.
 */
describe('OrdersService — buyer disputes', () => {
  let userFindUnique: ReturnType<typeof vi.fn>;
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let orderUpdate: ReturnType<typeof vi.fn>;
  let disputeFindFirst: ReturnType<typeof vi.fn>;
  let disputeFindUnique: ReturnType<typeof vi.fn>;
  let disputeCreate: ReturnType<typeof vi.fn>;
  let disputeUpdate: ReturnType<typeof vi.fn>;
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
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      status: 'DELIVERED',
      buyerTotalCents: 1500,
      stripePaymentIntentId: 'pi_1',
      stripeRefundId: null,
      deliveries: [
        {
          id: 'd1',
          deliveredConfirmedAt: new Date(),
          deliveredAsAbsent: false,
          deliveredAt: new Date(),
        },
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    userFindUnique = vi.fn().mockResolvedValue({ id: 'buyer-1' });
    orderFindUnique = vi.fn().mockResolvedValue(order());
    orderUpdate = vi.fn().mockResolvedValue({});
    disputeFindFirst = vi.fn().mockResolvedValue(null);
    disputeFindUnique = vi.fn();
    disputeCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data }));
    disputeUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'disp1',
      ...data,
    }));
    walletUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    refundsCreate = vi.fn().mockResolvedValue({ id: 're_1' });
    auditRecord = vi.fn().mockResolvedValue(undefined);
    addStrike = vi.fn().mockResolvedValue({ created: true, suspended: false });
    sendToUsers = vi.fn().mockResolvedValue(undefined);
    publish = vi.fn().mockResolvedValue(undefined);

    const prisma = {
      db: {
        user: { findUnique: userFindUnique },
        order: { findUnique: orderFindUnique, update: orderUpdate },
        orderDispute: {
          findFirst: disputeFindFirst,
          findUnique: disputeFindUnique,
          create: disputeCreate,
          update: disputeUpdate,
          findMany: vi.fn().mockResolvedValue([]),
        },
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

  it('lets the buyer file a dispute for their own order', async () => {
    orderFindUnique.mockResolvedValue(order({ status: 'DELIVERED' }));
    const { dispute } = await service.createDispute('sub-buyer', 'o1', { type: 'SPOILED_FOOD' });
    expect(dispute.status).toBe('ADMIN_REVIEW');
  });

  it('forbids another buyer from filing a dispute', async () => {
    userFindUnique.mockResolvedValue({ id: 'other-buyer' });
    await expect(
      service.createDispute('sub-other', 'o1', { type: 'WRONG_ORDER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a duplicate open dispute for the same order + type', async () => {
    disputeFindFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      service.createDispute('sub-buyer', 'o1', { type: 'SPOILED_FOOD' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects subjective dissatisfaction with no refund', async () => {
    const { dispute, message } = await service.createDispute('sub-buyer', 'o1', {
      type: 'SUBJECTIVE_DISSATISFACTION',
    });
    expect(dispute.status).toBe('REJECTED');
    expect(message).toContain('ne donne pas lieu à un remboursement');
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('never-received WITH delivery proof → ADMIN_REVIEW (no auto-refund)', async () => {
    orderFindUnique.mockResolvedValue(
      order({
        status: 'DELIVERED',
        deliveries: [
          {
            id: 'd1',
            deliveredConfirmedAt: new Date(),
            deliveredAsAbsent: false,
            deliveredAt: new Date(),
          },
        ],
      }),
    );
    const { dispute } = await service.createDispute('sub-buyer', 'o1', { type: 'NEVER_RECEIVED' });
    expect(dispute.status).toBe('ADMIN_REVIEW');
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('never-received WITHOUT proof → AUTO_REFUNDED', async () => {
    orderFindUnique.mockResolvedValue(
      order({
        status: 'IN_DELIVERY',
        deliveries: [
          { id: 'd1', deliveredConfirmedAt: null, deliveredAsAbsent: false, deliveredAt: null },
        ],
      }),
    );
    const { dispute } = await service.createDispute('sub-buyer', 'o1', { type: 'NEVER_RECEIVED' });
    expect(dispute.status).toBe('AUTO_REFUNDED');
    expect(refundsCreate).toHaveBeenCalled();
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REFUNDED' }) }),
    );
  });

  it('wrong order → AUTO_REFUNDED + seller strike', async () => {
    const { dispute } = await service.createDispute('sub-buyer', 'o1', { type: 'WRONG_ORDER' });
    expect(dispute.status).toBe('AUTO_REFUNDED');
    expect(refundsCreate).toHaveBeenCalled();
    expect(addStrike).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'seller-1', role: 'SELLER', reason: 'WRONG_ORDER' }),
    );
  });

  it('spoiled food → ADMIN_REVIEW, no refund', async () => {
    const { dispute } = await service.createDispute('sub-buyer', 'o1', { type: 'SPOILED_FOOD' });
    expect(dispute.status).toBe('ADMIN_REVIEW');
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('food poisoning requires proof', async () => {
    await expect(
      service.createDispute('sub-buyer', 'o1', { type: 'FOOD_POISONING' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('food poisoning with proof → ADMIN_REVIEW', async () => {
    const { dispute } = await service.createDispute('sub-buyer', 'o1', {
      type: 'FOOD_POISONING',
      proofFileUrls: ['avatars/buyer-1/cert'],
    });
    expect(dispute.status).toBe('ADMIN_REVIEW');
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('refund is idempotent (already refunded order is not refunded again)', async () => {
    orderFindUnique.mockResolvedValue(order({ stripeRefundId: 're_existing' }));
    const { dispute } = await service.createDispute('sub-buyer', 'o1', { type: 'WRONG_ORDER' });
    expect(dispute.status).toBe('AUTO_REFUNDED');
    expect(refundsCreate).not.toHaveBeenCalled(); // refundOrderIfNeeded skipped
  });

  // --- Admin actions ------------------------------------------------------

  it('admin can approve a refund (idempotent) and resolve the dispute', async () => {
    disputeFindUnique.mockResolvedValue({
      id: 'disp1',
      orderId: 'o1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      type: 'NEVER_RECEIVED',
      refundAmountCents: null,
      adminNotes: null,
    });
    orderFindUnique.mockResolvedValue(order({ stripeRefundId: null }));

    const updated = await service.adminApproveRefund('disp1', 'admin-1', 'OK refund');

    expect(refundsCreate).toHaveBeenCalled();
    expect(updated.status).toBe('RESOLVED');
    expect(updated.refundApproved).toBe(true);
  });

  it('admin can reject a dispute (no refund)', async () => {
    disputeFindUnique.mockResolvedValue({
      id: 'disp1',
      orderId: 'o1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      type: 'SPOILED_FOOD',
    });
    const updated = await service.adminRejectDispute('disp1', 'admin-1', 'insufficient');
    expect(updated.status).toBe('REJECTED');
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it('admin can resolve a dispute without refund', async () => {
    disputeFindUnique.mockResolvedValue({
      id: 'disp1',
      orderId: 'o1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      type: 'SPOILED_FOOD',
    });
    const updated = await service.adminResolveDispute('disp1', 'admin-1', 'handled offline');
    expect(updated.status).toBe('RESOLVED');
    expect(refundsCreate).not.toHaveBeenCalled();
  });
});
