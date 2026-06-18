import { ForbiddenException } from '@nestjs/common';
import { ConversationType, ParticipantRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '@infrastructure/database/prisma.service';

import { ConversationsService } from './conversations.service';

/**
 * Seller↔driver conversation: auto-created on claim, idempotent, and access is
 * limited to the two participants (buyer / other drivers are not participants
 * so `assertParticipant` rejects them).
 */
describe('ConversationsService — seller↔driver', () => {
  let orderFindUnique: ReturnType<typeof vi.fn>;
  let convFindFirst: ReturnType<typeof vi.fn>;
  let convCreate: ReturnType<typeof vi.fn>;
  let participantCreateMany: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let userFindUnique: ReturnType<typeof vi.fn>;
  let participantFindUnique: ReturnType<typeof vi.fn>;
  let service: ConversationsService;

  beforeEach(() => {
    orderFindUnique = vi.fn();
    convFindFirst = vi.fn();
    convCreate = vi.fn();
    participantCreateMany = vi.fn();
    userFindUnique = vi.fn();
    participantFindUnique = vi.fn();
    transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        conversation: { create: convCreate },
        conversationParticipant: { createMany: participantCreateMany },
      }),
    );

    const prisma = {
      $transaction: transaction,
      db: {
        order: { findUnique: orderFindUnique },
        conversation: { findFirst: convFindFirst },
        user: { findUnique: userFindUnique },
        conversationParticipant: { findUnique: participantFindUnique },
      },
    } as unknown as PrismaService;

    service = new ConversationsService(prisma);
  });

  it('creates a seller↔driver conversation on first claim', async () => {
    orderFindUnique.mockResolvedValue({ sellerId: 'seller-1' });
    convFindFirst.mockResolvedValue(null);

    const res = await service.ensureSellerDriverConversation('order-1', 'driver-1', 'delivery-1');

    expect(res.created).toBe(true);
    expect(convCreate).toHaveBeenCalledTimes(1);
    // Two participants: seller (SELLER) + driver (DELIVERY).
    const data = participantCreateMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data.map((p: { role: ParticipantRole }) => p.role).sort()).toEqual(
      [ParticipantRole.DELIVERY, ParticipantRole.SELLER].sort(),
    );
    expect(convCreate.mock.calls[0][0].data.type).toBe(ConversationType.SELLER_DRIVER);
  });

  it('reuses the existing conversation on a repeated claim (no duplicate)', async () => {
    orderFindUnique.mockResolvedValue({ sellerId: 'seller-1' });
    convFindFirst.mockResolvedValue({ id: 'conv-existing' });

    const res = await service.ensureSellerDriverConversation('order-1', 'driver-1');

    expect(res).toEqual({ id: 'conv-existing', created: false });
    expect(convCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('no-ops when the order is missing (never throws — claim must not break)', async () => {
    orderFindUnique.mockResolvedValue(null);
    const res = await service.ensureSellerDriverConversation('order-x', 'driver-1');
    expect(res).toEqual({ id: null, created: false });
    expect(convCreate).not.toHaveBeenCalled();
  });

  it('rejects a non-participant (buyer / other driver cannot access)', async () => {
    userFindUnique.mockResolvedValue({ id: 'intruder' });
    participantFindUnique.mockResolvedValue(null); // not a participant
    await expect(service.assertParticipant('sub-intruder', 'conv-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
