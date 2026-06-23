import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WalletEntryStatus, WalletEntryType } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { FulfillmentChoice } from '@common/enums/fulfillment-choice.enum';
import { OrderStatus } from '@common/enums/order-status.enum';
import { UserRole } from '@common/enums/user-role.enum';
import { DomainException } from '@common/exceptions/domain.exception';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { NotificationsService } from '@modules/notifications/notifications.service';

/** Commission rows are booked under this synthetic user (platform accounting,
 *  never counted toward a real user's balance). */
const PLATFORM_USER_ID = 'PLATFORM';

/** Minimum AVAILABLE balance (cents) to request a withdrawal — 50 €. */
export const WITHDRAWAL_MIN_CENTS = 5000;

/**
 * Safety window before seller/driver earnings become withdrawable: they're
 * credited PENDING at delivery and released to AVAILABLE only after this delay,
 * so a refund during the claim window can still reverse them. Env-overridable.
 */
const WALLET_RELEASE_HOURS = Number(process.env.WALLET_RELEASE_HOURS ?? 24);

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly notifications: NotificationsService,
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
          select: { driverId: true, deliveredAt: true },
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
    // Earnings are credited PENDING and released to AVAILABLE only after the
    // 24h safety window (deliveredAt + WALLET_RELEASE_HOURS), so a refund during
    // the claim window can still reverse them. Disputed → HELD (never released
    // automatically). The platform commission is always immediately AVAILABLE.
    const deliveredAt = order.deliveries[0]?.deliveredAt ?? new Date();
    const earningStatus = disputed ? WalletEntryStatus.HELD : WalletEntryStatus.PENDING;
    const availableAt = disputed
      ? null
      : new Date(deliveredAt.getTime() + WALLET_RELEASE_HOURS * 60 * 60 * 1000);

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
    // Earnings credited PENDING → they're scheduled for release by the sweep.
    if (res.count > 0 && earningStatus === WalletEntryStatus.PENDING) {
      this.logger.log(`[WalletRelease] pending created orderId=${orderId}`);
      for (const row of rows) {
        if (row.status === WalletEntryStatus.PENDING) {
          this.logger.log(
            `[WalletRelease] scheduled entryId=${row.id} availableAt=${row.availableAt?.toISOString()}`,
          );
        }
      }
    }
  }

  /**
   * Compensates a driver for a wasted trip when an order is cancelled before
   * delivery (e.g. seller unavailable at pickup). Credits the delivery fee as
   * AVAILABLE immediately — the driver is paid for the trip regardless of the
   * cancellation, so the 24h refund-safety window doesn't apply here. Idempotent
   * via the (orderId, userId, type) unique constraint.
   */
  async compensateDriver(orderId: string, driverId: string, amountCents: number): Promise<void> {
    if (amountCents <= 0) return;
    const res = await this.prisma.db.walletEntry.createMany({
      data: [
        {
          id: generateUlid(),
          userId: driverId,
          orderId,
          type: WalletEntryType.DELIVERY_EARNING,
          amountCents,
          status: WalletEntryStatus.AVAILABLE,
          availableAt: new Date(),
          metadata: { compensation: 'seller_unavailable' },
        },
      ],
      skipDuplicates: true,
    });
    if (res.count > 0) {
      this.logger.log(
        `[SellerUnavailable] driver compensated userId=${driverId} orderId=${orderId} amount=${amountCents}`,
      );
    }
  }

  /**
   * Credits a seller's order earning AVAILABLE immediately, outside the normal
   * delivered path. Used when the seller fulfilled their part but the order
   * didn't complete normally (e.g. driver disappeared after pickup): the order
   * is cancelled, so a PENDING entry would be reversed by the release sweep —
   * the seller is paid now. Idempotent via the (orderId, userId, type) unique.
   */
  async creditSellerEarning(orderId: string, sellerId: string, amountCents: number): Promise<void> {
    if (amountCents <= 0) return;
    const res = await this.prisma.db.walletEntry.createMany({
      data: [
        {
          id: generateUlid(),
          userId: sellerId,
          orderId,
          type: WalletEntryType.ORDER_EARNING,
          amountCents,
          status: WalletEntryStatus.AVAILABLE,
          availableAt: new Date(),
          metadata: { reason: 'driver_disappeared_seller_paid' },
        },
      ],
      skipDuplicates: true,
    });
    if (res.count > 0) {
      this.logger.log(
        `[DriverDisappeared] seller earning created userId=${sellerId} orderId=${orderId} amount=${amountCents}`,
      );
    }
  }

  /**
   * Records a driver wallet debt (negative AVAILABLE entry) for the refunded
   * amount when a driver disappears after pickup. Because it's an AVAILABLE
   * entry, it nets against the driver's available balance: if they have funds
   * it's deducted now; otherwise the balance goes negative (debt) and cashout
   * is blocked until future earnings cover it. Idempotent via the
   * (orderId, userId, type) unique constraint — the platform absorbs whatever
   * the wallet never recovers. Logged with the positive magnitude.
   */
  async recordDriverDebt(orderId: string, driverId: string, amountCents: number): Promise<void> {
    if (amountCents <= 0) return;
    const res = await this.prisma.db.walletEntry.createMany({
      data: [
        {
          id: generateUlid(),
          userId: driverId,
          orderId,
          type: WalletEntryType.DRIVER_DEBT,
          amountCents: -amountCents,
          status: WalletEntryStatus.AVAILABLE,
          availableAt: new Date(),
          metadata: { reason: 'driver_disappeared_refund_deduction' },
        },
      ],
      skipDuplicates: true,
    });
    if (res.count > 0) {
      this.logger.log(
        `[DriverDebt] created driverId=${driverId} orderId=${orderId} amountCents=${amountCents}`,
      );
    }
  }

  /**
   * Periodic release sweep. Runs in the API process (ScheduleModule is global);
   * a future BullMQ worker can call [releaseDuePendingEntries] instead — the
   * logic is idempotent and process-agnostic.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async releasePendingCron(): Promise<void> {
    try {
      await this.releaseDuePendingEntries();
    } catch (err) {
      this.logger.error(`[WalletRelease] sweep failed: ${(err as Error).message}`);
    }
  }

  /**
   * Releases PENDING earnings whose 24h window has elapsed, provided the order
   * is still delivered (no refund/cancel/dispute). Idempotent: only flips rows
   * that are still PENDING, so re-running (or a later BullMQ call) is safe.
   * Refunded/cancelled orders' pending rows are reversed to CANCELLED instead.
   */
  async releaseDuePendingEntries(now: Date = new Date()): Promise<{ released: number }> {
    const due = await this.prisma.db.walletEntry.findMany({
      where: {
        status: WalletEntryStatus.PENDING,
        availableAt: { lte: now },
        type: { in: [WalletEntryType.ORDER_EARNING, WalletEntryType.DELIVERY_EARNING] },
      },
      select: { id: true, userId: true, orderId: true },
    });
    if (due.length === 0) return { released: 0 };

    const orderIds = [...new Set(due.map((e) => e.orderId).filter((id): id is string => !!id))];
    const orders = await this.prisma.db.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, status: true },
    });
    const statusByOrder = new Map(orders.map((o) => [o.id, o.status]));

    const releasable: string[] = [];
    const reversible: string[] = [];
    const releasedUserIds = new Set<string>();
    for (const entry of due) {
      const status = entry.orderId ? statusByOrder.get(entry.orderId) : undefined;
      if (status === OrderStatus.Delivered || status === OrderStatus.Completed) {
        releasable.push(entry.id);
        releasedUserIds.add(entry.userId);
      } else if (status === OrderStatus.Cancelled || status === OrderStatus.Refunded) {
        reversible.push(entry.id);
        this.logger.log(`[WalletRelease] skipped reason=refunded orderId=${entry.orderId}`);
      } else {
        // Disputed / not-yet-final — leave PENDING for a later sweep.
        this.logger.log(
          `[WalletRelease] skipped reason=disputed orderId=${entry.orderId} status=${status ?? 'unknown'}`,
        );
      }
    }

    if (releasable.length > 0) {
      // status: PENDING guard makes this a no-op on re-run (idempotent).
      await this.prisma.db.walletEntry.updateMany({
        where: { id: { in: releasable }, status: WalletEntryStatus.PENDING },
        data: { status: WalletEntryStatus.AVAILABLE, releasedAt: now },
      });
      for (const id of releasable) {
        this.logger.log(`[WalletRelease] released entryId=${id}`);
      }
      // Best-effort "funds available" push per beneficiary.
      for (const userId of releasedUserIds) {
        try {
          await this.notifications.sendToUsers([userId], {
            title: 'Gains disponibles',
            body: 'Vos gains sont disponibles au retrait.',
            data: { type: 'wallet_funds_available' },
          });
        } catch {
          // best-effort
        }
      }
    }

    if (reversible.length > 0) {
      await this.prisma.db.walletEntry.updateMany({
        where: { id: { in: reversible }, status: WalletEntryStatus.PENDING },
        data: { status: WalletEntryStatus.CANCELLED },
      });
    }

    return { released: releasable.length };
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
    const [availableRaw, pendingCents, heldCents, paidOutCents, entries] = await Promise.all([
      // Net of all AVAILABLE entries — includes negative DRIVER_DEBT rows, so a
      // driver in debt has a negative raw available balance.
      this.sumByStatus(user.id, WalletEntryStatus.AVAILABLE),
      this.sumByStatus(user.id, WalletEntryStatus.PENDING),
      this.sumByStatus(user.id, WalletEntryStatus.HELD),
      this.sumByStatus(user.id, WalletEntryStatus.PAID_OUT),
      this.prisma.db.walletEntry.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const availableCents = Math.max(0, availableRaw);
    const debtCents = availableRaw < 0 ? -availableRaw : 0;
    return {
      availableCents,
      pendingCents,
      heldCents,
      paidOutCents,
      // Outstanding debt (refund clawback not yet covered by earnings).
      debtCents,
      // Visible total of money owed to the user (net of any debt).
      totalBalanceCents: availableRaw + pendingCents + heldCents,
      minWithdrawalCents: WITHDRAWAL_MIN_CENTS,
      // No cashout while in debt.
      canWithdraw: debtCents === 0 && availableCents >= WITHDRAWAL_MIN_CENTS,
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

    // All AVAILABLE entries, INCLUDING negative DRIVER_DEBT rows so the net
    // governs the payout. Settling them all on withdrawal also clears any debt
    // that the positive earnings cover.
    const available = await this.prisma.db.walletEntry.findMany({
      where: {
        userId: user.id,
        status: WalletEntryStatus.AVAILABLE,
      },
      select: { id: true, amountCents: true, type: true },
    });
    const total = available.reduce((s, e) => s + e.amountCents, 0);
    // Debt (net negative) blocks cashout entirely.
    if (total < 0) {
      this.logger.warn(`[DriverDebt] cashout blocked driverId=${user.id} debtCents=${-total}`);
      throw new BadRequestException('Retrait impossible : votre solde présente une dette.');
    }
    if (total < WITHDRAWAL_MIN_CENTS) {
      throw new BadRequestException(
        `Solde insuffisant pour un retrait (minimum ${(WITHDRAWAL_MIN_CENTS / 100).toFixed(2)} €, disponible ${(total / 100).toFixed(2)} €).`,
      );
    }

    // The net is positive but settles negative DRIVER_DEBT rows too: future
    // earnings have covered the debt, and the surplus is what's paid out.
    const debtSettled = available
      .filter((e) => e.amountCents < 0)
      .reduce((s, e) => s - e.amountCents, 0);
    if (debtSettled > 0) {
      this.logger.log(
        `[DriverDebt] future earning offset debt driverId=${user.id} amountCents=${debtSettled}`,
      );
    }

    // Cashout gate: Stripe Connect payout setup is required ONLY here (not to
    // claim/earn). Need a completed onboarding AND a Connect account id. Typed
    // code so the app can show the "set up payments" prompt.
    const payout = await this.resolvePayoutTarget(user.id, user.role);
    if (!payout.onboardingCompleted || !payout.accountId) {
      throw new DomainException(
        ErrorCodes.PayoutSetupRequired,
        'Configurez vos paiements pour retirer vos gains.',
        HttpStatus.FORBIDDEN,
      );
    }
    const connectAccountId = payout.accountId;

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

  /** Resolves the user's Stripe Connect payout target: the account id and
   *  whether onboarding is complete. Both are required before a withdrawal. */
  private async resolvePayoutTarget(
    userId: string,
    role: string,
  ): Promise<{ accountId: string | null; onboardingCompleted: boolean }> {
    if (role === UserRole.Driver) {
      const d = await this.prisma.db.driverProfile.findUnique({
        where: { userId },
        select: { stripeConnectAccountId: true, stripeOnboardingCompleted: true },
      });
      return {
        accountId: d?.stripeConnectAccountId ?? null,
        onboardingCompleted: d?.stripeOnboardingCompleted ?? false,
      };
    }
    const s = await this.prisma.db.sellerProfile.findUnique({
      where: { userId },
      select: { stripeConnectAccountId: true, stripeOnboardingCompleted: true },
    });
    return {
      accountId: s?.stripeConnectAccountId ?? null,
      onboardingCompleted: s?.stripeOnboardingCompleted ?? false,
    };
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
  pendingCents: number;
  heldCents: number;
  paidOutCents: number;
  debtCents: number;
  totalBalanceCents: number;
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
