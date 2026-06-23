import { Injectable, Logger } from '@nestjs/common';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { NotificationsService } from '@modules/notifications/notifications.service';

export type ActorRole = 'SELLER' | 'DRIVER' | 'BUYER';
export type StrikeSeverity = 'LIGHT' | 'SERIOUS' | 'CRITICAL';
export type StrikeSourceType = 'DELIVERY' | 'ORDER' | 'REPORT' | 'SYSTEM';

/** Points within this window count toward suspension; older strikes are history. */
export const STRIKE_WINDOW_DAYS = 90;
/** Active points that trigger suspension. */
export const SUSPENSION_THRESHOLD_POINTS = 3;

export interface AddStrikeInput {
  userId: string;
  role: ActorRole;
  points: number;
  reason: string;
  severity: StrikeSeverity;
  sourceType: StrikeSourceType;
  sourceId?: string | null;
  orderId?: string | null;
  deliveryId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Reusable strike/exclusion engine for sellers, drivers, and buyers. Light = 1pt,
 * serious = 2pts; 3 active points (within 90 days) → suspension, and a CRITICAL
 * strike can exclude immediately. One incident never strikes twice (deduped by
 * user+role+reason+source). Suspension is an account flag enforced at each
 * role's entry points.
 */
@Injectable()
export class StrikesService {
  private readonly logger = new Logger(StrikesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Records a strike (idempotent per source) and re-evaluates suspension.
   * Returns whether a new strike was created and whether the user is now
   * suspended.
   */
  async addStrike(input: AddStrikeInput): Promise<{ created: boolean; suspended: boolean }> {
    const { userId, role, reason } = input;

    // Idempotency: never double-strike the same incident. Keyed by the most
    // specific source identifier provided.
    const sourceKey = input.deliveryId
      ? { deliveryId: input.deliveryId }
      : input.orderId
        ? { orderId: input.orderId }
        : input.sourceId
          ? { sourceId: input.sourceId }
          : null;
    if (sourceKey) {
      const existing = await this.prisma.db.strike.findFirst({
        where: { userId, actorRole: role, reason, ...sourceKey },
        select: { id: true },
      });
      if (existing) {
        this.logger.log(
          `[Strikes] skipped duplicate source=${JSON.stringify(sourceKey)} userId=${userId} reason=${reason}`,
        );
        return { created: false, suspended: await this.isSuspended(userId) };
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + STRIKE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.db.strike.create({
      data: {
        id: generateUlid(),
        userId,
        actorRole: role,
        points: input.points,
        reason,
        severity: input.severity,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        orderId: input.orderId ?? null,
        deliveryId: input.deliveryId ?? null,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
        metadata: (input.metadata ?? undefined) as never,
        expiresAt,
      },
    });
    this.logger.log(
      `[Strikes] added userId=${userId} role=${role} points=${input.points} reason=${reason}`,
    );

    const suspended = await this.evaluateSuspension(userId, role, reason);
    return { created: true, suspended };
  }

  /** Sum of active (within 90 days) strike points for a user in a role. */
  async getActiveStrikePoints(userId: string, role: ActorRole): Promise<number> {
    const cutoff = new Date(Date.now() - STRIKE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const agg = await this.prisma.db.strike.aggregate({
      where: { userId, actorRole: role, createdAt: { gte: cutoff } },
      _sum: { points: true },
    });
    return agg._sum.points ?? 0;
  }

  /** Suspends the user when active points reach the threshold. Returns true if suspended. */
  async evaluateSuspension(userId: string, role: ActorRole, reason?: string): Promise<boolean> {
    const points = await this.getActiveStrikePoints(userId, role);
    if (points >= SUSPENSION_THRESHOLD_POINTS) {
      this.logger.log(`[Strikes] threshold reached userId=${userId} role=${role} points=${points}`);
      await this.suspendUser(userId, role, reason ?? 'strike_threshold_reached');
      return true;
    }
    return false;
  }

  /**
   * Flags the account suspended (idempotent). Best-effort push to the user.
   * Pass [opts.message] to override the default push body (e.g. a
   * rating-based suspension reason). The push fires only on the transition to
   * suspended, so callers don't double-notify an already-suspended user.
   */
  async suspendUser(
    userId: string,
    role: ActorRole,
    reason: string,
    opts?: { message?: string },
  ): Promise<void> {
    const res = await this.prisma.db.user.updateMany({
      where: { id: userId, isSuspended: false },
      data: { isSuspended: true, suspendedAt: new Date(), suspensionReason: reason },
    });
    if (res.count > 0) {
      this.logger.log(`[Strikes] suspended userId=${userId} role=${role} reason=${reason}`);
      try {
        await this.notifications.sendToUsers([userId], {
          title: 'Compte suspendu',
          body: opts?.message ?? 'Votre compte a été suspendu suite à des incidents répétés.',
          data: { type: 'account_suspended', role },
        });
      } catch {
        // best-effort
      }
    }
  }

  /** Lifts a suspension (admin). */
  async unsuspendUser(userId: string): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { isSuspended: false, suspendedAt: null, suspensionReason: null },
    });
    this.logger.log(`[Strikes] unsuspended userId=${userId}`);
  }

  /**
   * Critical infraction (e.g. driver theft / non-delivery after pickup): records
   * a CRITICAL strike and force-suspends immediately, regardless of the 90-day
   * point count. Idempotent.
   */
  async immediateExclude(
    userId: string,
    role: ActorRole,
    reason: string,
    source: { sourceType: StrikeSourceType; deliveryId?: string | null; orderId?: string | null },
  ): Promise<void> {
    await this.addStrike({
      userId,
      role,
      points: SUSPENSION_THRESHOLD_POINTS,
      reason,
      severity: 'CRITICAL',
      sourceType: source.sourceType,
      deliveryId: source.deliveryId ?? null,
      orderId: source.orderId ?? null,
    });
    this.logger.log(`[Strikes] immediate exclusion userId=${userId} role=${role} reason=${reason}`);
    // Force-suspend even if the strike was a duplicate (idempotent).
    await this.suspendUser(userId, role, reason);
  }

  /** Strike history for a user (admin read), newest first. */
  async listForUser(userId: string) {
    return this.prisma.db.strike.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private async isSuspended(userId: string): Promise<boolean> {
    const u = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { isSuspended: true },
    });
    return u?.isSuspended ?? false;
  }
}
