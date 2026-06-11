import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WalletEntryStatus, WalletEntryType } from '@prisma/client';

import { FulfillmentChoice } from '@common/enums/fulfillment-choice.enum';
import { OrderStatus } from '@common/enums/order-status.enum';
import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

/** Commission rows are booked under this synthetic user (platform accounting,
 *  never counted toward a real user's balance). */
const PLATFORM_USER_ID = 'PLATFORM';

/** Minimum AVAILABLE balance (cents) to request a withdrawal — 50 €. */
export const WITHDRAWAL_MIN_CENTS = 5000;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Idempotently credits the internal wallet ledger for a completed order
   * (delivered / reception-validated). NEVER transfers money — real payouts
   * happen on withdrawal. Credits seller net + driver fee (DELIVERY) as
   * AVAILABLE (or HELD when the order is DISPUTED), and books the platform
   * commission. Cancelled / refunded / not-yet-delivered orders are skipped.
   *
   * Idempotency: the `(orderId, userId, type)` unique constraint + a
   * `skipDuplicates` insert means a duplicate delivery-confirmation or webhook
   * can never double-credit.
   */
  async creditForCompletedOrder(orderId: string): Promise<void> {
    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        fulfillmentChoice: true,
        sellerEarningsCents: true,
        commissionCents: true,
        fulfillmentFeeCents: true,
        deliveries: {
          where: { status: 'DELIVERED' },
          select: { driverId: true },
          orderBy: { deliveredAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!order) return;

    const completed =
      order.status === OrderStatus.Delivered || order.status === OrderStatus.Completed;
    const disputed = order.status === OrderStatus.Disputed;
    // Never credit a cancelled/refunded/pending order.
    if (!completed && !disputed) {
      this.logger.debug(`[wallet] skip credit for ${orderId}: status=${order.status}`);
      return;
    }
    // Disputed (or CGU/CGV violation) → held, not payable.
    const earningStatus = disputed ? WalletEntryStatus.HELD : WalletEntryStatus.AVAILABLE;
    const availableAt = disputed ? null : new Date();

    const rows: Array<{
      id: string;
      userId: string;
      orderId: string;
      type: WalletEntryType;
      amountCents: number;
      status: WalletEntryStatus;
      availableAt: Date | null;
    }> = [];

    if (order.sellerEarningsCents > 0) {
      rows.push({
        id: generateUlid(),
        userId: order.sellerId,
        orderId,
        type: WalletEntryType.ORDER_EARNING,
        amountCents: order.sellerEarningsCents,
        status: earningStatus,
        availableAt,
      });
    }
    if (order.commissionCents > 0) {
      // Platform accounting row — always AVAILABLE (it's the platform's cut).
      rows.push({
        id: generateUlid(),
        userId: PLATFORM_USER_ID,
        orderId,
        type: WalletEntryType.COMMISSION,
        amountCents: order.commissionCents,
        status: WalletEntryStatus.AVAILABLE,
        availableAt: new Date(),
      });
    }
    const driverId = order.deliveries[0]?.driverId;
    if (
      order.fulfillmentChoice === FulfillmentChoice.Delivery &&
      driverId &&
      order.fulfillmentFeeCents > 0
    ) {
      rows.push({
        id: generateUlid(),
        userId: driverId,
        orderId,
        type: WalletEntryType.DELIVERY_EARNING,
        amountCents: order.fulfillmentFeeCents,
        status: earningStatus,
        availableAt,
      });
    }

    if (rows.length === 0) return;
    const res = await this.prisma.db.walletEntry.createMany({
      data: rows,
      skipDuplicates: true,
    });
    this.logger.log(
      `[wallet] order ${orderId} credited: ${res.count} new entries ` +
        `(seller=${order.sellerEarningsCents}, commission=${order.commissionCents}, ` +
        `driver=${driverId ? order.fulfillmentFeeCents : 0}, status=${earningStatus})`,
    );
  }

  /** Sum of a user's entries in a given status (cents). */
  private async sumByStatus(userId: string, status: WalletEntryStatus): Promise<number> {
    const agg = await this.prisma.db.walletEntry.aggregate({
      where: { userId, status },
      _sum: { amountCents: true },
    });
    return agg._sum.amountCents ?? 0;
  }

  /** Wallet summary + recent entries for the authenticated user. */
  async summary(supabaseId: string): Promise<WalletSummary> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User profile not found');
    const [availableCents, heldCents, paidOutCents, entries] = await Promise.all([
      this.sumByStatus(user.id, WalletEntryStatus.AVAILABLE),
      this.sumByStatus(user.id, WalletEntryStatus.HELD),
      this.sumByStatus(user.id, WalletEntryStatus.PAID_OUT),
      this.prisma.db.walletEntry.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      availableCents,
      heldCents,
      paidOutCents,
      minWithdrawalCents: WITHDRAWAL_MIN_CENTS,
      canWithdraw: availableCents >= WITHDRAWAL_MIN_CENTS,
      entries: entries.map((e) => ({
        id: e.id,
        orderId: e.orderId,
        type: e.type,
        amountCents: e.amountCents,
        status: e.status,
        createdAt: e.createdAt,
      })),
    };
  }

  /**
   * Withdraws the full AVAILABLE balance to the user's Connect account.
   * Requires balance >= [WITHDRAWAL_MIN_CENTS]. Creates ONE Stripe transfer
   * (idempotency-keyed), then flips the paid entries to PAID_OUT and books a
   * WITHDRAWAL debit. Real money only moves here, never at delivery.
   */
  async requestWithdrawal(
    supabaseId: string,
  ): Promise<{ withdrawalId: string; amountCents: number; transferId: string }> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('User profile not found');

    // Threshold check FIRST (clearest error, independent of Connect setup).
    const available = await this.prisma.db.walletEntry.findMany({
      where: {
        userId: user.id,
        status: WalletEntryStatus.AVAILABLE,
        amountCents: { gt: 0 },
      },
      select: { id: true, amountCents: true },
    });
    const total = available.reduce((s, e) => s + e.amountCents, 0);
    if (total < WITHDRAWAL_MIN_CENTS) {
      throw new BadRequestException(
        `Solde insuffisant pour un retrait (minimum ${(WITHDRAWAL_MIN_CENTS / 100).toFixed(2)} €, disponible ${(total / 100).toFixed(2)} €).`,
      );
    }

    const connectAccountId = await this.resolveConnectAccount(user.id, user.role);
    if (!connectAccountId) {
      throw new BadRequestException(
        'Compte de paiement non configuré (onboarding Stripe Connect requis).',
      );
    }

    const withdrawalId = generateUlid();
    let transferId: string;
    try {
      const transfer = await this.stripe.client.transfers.create(
        {
          amount: total,
          currency: 'eur',
          destination: connectAccountId,
          metadata: { withdrawalId, userId: user.id },
        },
        { idempotencyKey: `withdrawal_${withdrawalId}` },
      );
      transferId = transfer.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Withdrawal transfer failed for ${user.id}: ${message}`);
      throw new BadRequestException(`Le virement a échoué : ${message}`);
    }

    // Atomically settle the ledger: paid entries → PAID_OUT + a debit row.
    await this.prisma.$transaction([
      this.prisma.db.walletEntry.updateMany({
        where: { id: { in: available.map((e) => e.id) } },
        data: { status: WalletEntryStatus.PAID_OUT, withdrawalId },
      }),
      this.prisma.db.walletEntry.create({
        data: {
          id: generateUlid(),
          userId: user.id,
          type: WalletEntryType.WITHDRAWAL,
          amountCents: -total,
          status: WalletEntryStatus.PAID_OUT,
          withdrawalId,
          metadata: { transferId, destination: connectAccountId },
        },
      }),
    ]);

    this.logger.log(
      `[wallet] withdrawal ${withdrawalId} for ${user.id}: ${total} cents → transfer ${transferId}`,
    );
    return { withdrawalId, amountCents: total, transferId };
  }

  private async resolveConnectAccount(userId: string, role: string): Promise<string | null> {
    if (role === UserRole.Driver) {
      const d = await this.prisma.db.driverProfile.findUnique({
        where: { userId },
        select: { stripeConnectAccountId: true },
      });
      return d?.stripeConnectAccountId ?? null;
    }
    const s = await this.prisma.db.sellerProfile.findUnique({
      where: { userId },
      select: { stripeConnectAccountId: true },
    });
    return s?.stripeConnectAccountId ?? null;
  }

  /** Admin: per-order financial breakdown (debug visibility). */
  async orderFinancials(orderId: string): Promise<OrderFinancials> {
    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        buyerTotalCents: true,
        subtotalCents: true,
        fulfillmentFeeCents: true,
        commissionCents: true,
        sellerEarningsCents: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const entries = await this.prisma.db.walletEntry.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      order,
      walletEntries: entries.map((e) => ({
        userId: e.userId,
        type: e.type,
        amountCents: e.amountCents,
        status: e.status,
        withdrawalId: e.withdrawalId,
        transferId: (e.metadata as { transferId?: string } | null)?.transferId ?? null,
      })),
    };
  }
}

export interface WalletSummary {
  availableCents: number;
  heldCents: number;
  paidOutCents: number;
  minWithdrawalCents: number;
  canWithdraw: boolean;
  entries: Array<{
    id: string;
    orderId: string | null;
    type: WalletEntryType;
    amountCents: number;
    status: WalletEntryStatus;
    createdAt: Date;
  }>;
}

export interface OrderFinancials {
  order: {
    id: string;
    status: string;
    buyerTotalCents: number;
    subtotalCents: number;
    fulfillmentFeeCents: number;
    commissionCents: number;
    sellerEarningsCents: number;
  };
  walletEntries: Array<{
    userId: string;
    type: WalletEntryType;
    amountCents: number;
    status: WalletEntryStatus;
    withdrawalId: string | null;
    transferId: string | null;
  }>;
}
