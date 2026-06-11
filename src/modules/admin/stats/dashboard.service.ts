import { Injectable } from '@nestjs/common';
import { OrderStatus, SellerCategory } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { DashboardQueryDto, DashboardRange } from './dto/dashboard-query.dto';

/** Order statuses that represent a real, paid transaction (money captured). */
const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.PICKED_UP,
  OrderStatus.IN_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
];
const CANCELLED_STATUSES: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];

const DAY_MS = 24 * 60 * 60 * 1000;
const EPOCH = new Date('1970-01-01T00:00:00.000Z');
const FAR_FUTURE = new Date('2999-12-31T23:59:59.999Z');

interface ResolvedRange {
  from: Date | null;
  to: Date | null;
}

export interface DashboardOverview {
  totalUsers: number;
  totalBuyers: number;
  totalSellers: number;
  totalDrivers: number;
  totalListings: number;
  activeListings: number;
  totalOrders: number;
  confirmedOrders: number;
  cancelledOrders: number;
  totalRevenueCents: number;
  totalCommissionCents: number;
  totalDeliveryFeeCents: number;
  recurringUsersCount: number;
  monoUsersCount: number;
  range: { from: string | null; to: string | null };
}

/**
 * Real DB aggregations for the admin dashboard. Order-derived metrics honour
 * the requested date window (`placedAt`); user/listing totals are
 * current-state counts. `recurringUsersCount` always uses its fixed
 * "≥2 paid transactions in the last 7 days" definition.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- date window -------------------------------------------------------

  private resolveRange(q: DashboardQueryDto): ResolvedRange {
    if (q.dateFrom || q.dateTo) {
      return {
        from: q.dateFrom ? new Date(q.dateFrom) : null,
        to: q.dateTo ? new Date(q.dateTo) : null,
      };
    }
    const now = new Date();
    switch (q.range) {
      case DashboardRange.Today: {
        const from = new Date(now);
        from.setHours(0, 0, 0, 0);
        return { from, to: null };
      }
      case DashboardRange.Last7Days:
        return { from: new Date(now.getTime() - 7 * DAY_MS), to: null };
      case DashboardRange.Last30Days:
        return { from: new Date(now.getTime() - 30 * DAY_MS), to: null };
      case DashboardRange.All:
      default:
        return { from: null, to: null };
    }
  }

  /** Prisma `where` fragment for placedAt within the resolved window. */
  private placedAtWhere({ from, to }: ResolvedRange): {
    placedAt?: { gte?: Date; lte?: Date };
  } {
    if (!from && !to) return {};
    return {
      placedAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    };
  }

  // ---- overview ----------------------------------------------------------

  async overview(q: DashboardQueryDto): Promise<DashboardOverview> {
    const range = this.resolveRange(q);
    const dateWhere = this.placedAtWhere(range);
    const now = new Date();

    const [
      totalUsers,
      totalBuyers,
      totalSellers,
      totalDrivers,
      totalListings,
      activeListings,
      totalOrders,
      confirmedOrders,
      cancelledOrders,
      paidAgg,
      recurringUsersCount,
      monoUsersCount,
    ] = await Promise.all([
      this.prisma.db.user.count(),
      this.prisma.db.user.count({ where: { role: 'BUYER' } }),
      this.prisma.db.user.count({ where: { role: 'SELLER' } }),
      this.prisma.db.user.count({ where: { role: 'DRIVER' } }),
      this.prisma.db.listing.count({ where: { deletedAt: null } }),
      this.prisma.db.listing.count({
        where: {
          deletedAt: null,
          isAvailable: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      this.prisma.db.order.count({ where: { ...dateWhere } }),
      this.prisma.db.order.count({
        where: { ...dateWhere, status: { in: PAID_STATUSES } },
      }),
      this.prisma.db.order.count({
        where: { ...dateWhere, status: { in: CANCELLED_STATUSES } },
      }),
      this.prisma.db.order.aggregate({
        where: { ...dateWhere, status: { in: PAID_STATUSES } },
        _sum: {
          buyerTotalCents: true,
          commissionCents: true,
          fulfillmentFeeCents: true,
        },
      }),
      this.recurringUsersCount(),
      this.monoUsersCount(range),
    ]);

    return {
      totalUsers,
      totalBuyers,
      totalSellers,
      totalDrivers,
      totalListings,
      activeListings,
      totalOrders,
      confirmedOrders,
      cancelledOrders,
      totalRevenueCents: paidAgg._sum.buyerTotalCents ?? 0,
      totalCommissionCents: paidAgg._sum.commissionCents ?? 0,
      totalDeliveryFeeCents: paidAgg._sum.fulfillmentFeeCents ?? 0,
      recurringUsersCount,
      monoUsersCount,
      range: {
        from: range.from ? range.from.toISOString() : null,
        to: range.to ? range.to.toISOString() : null,
      },
    };
  }

  // ---- user breakdown ----------------------------------------------------

  async userStats(q: DashboardQueryDto): Promise<{
    totalUsers: number;
    totalBuyers: number;
    totalSellers: number;
    totalDrivers: number;
    recurringUsersCount: number;
    monoUsersCount: number;
  }> {
    const range = this.resolveRange(q);
    const [
      totalUsers,
      totalBuyers,
      totalSellers,
      totalDrivers,
      recurringUsersCount,
      monoUsersCount,
    ] = await Promise.all([
      this.prisma.db.user.count(),
      this.prisma.db.user.count({ where: { role: 'BUYER' } }),
      this.prisma.db.user.count({ where: { role: 'SELLER' } }),
      this.prisma.db.user.count({ where: { role: 'DRIVER' } }),
      this.recurringUsersCount(),
      this.monoUsersCount(range),
    ]);
    return {
      totalUsers,
      totalBuyers,
      totalSellers,
      totalDrivers,
      recurringUsersCount,
      monoUsersCount,
    };
  }

  // ---- revenue summary (totals + breakdowns) -----------------------------

  async revenueSummary(q: DashboardQueryDto): Promise<{
    totalRevenueCents: number;
    totalCommissionCents: number;
    totalDeliveryFeeCents: number;
    byCategory: Array<{
      category: SellerCategory;
      orderCount: number;
      revenueCents: number;
      commissionCents: number;
    }>;
    byCity: Array<{ city: string; orderCount: number; revenueCents: number }>;
  }> {
    const range = this.resolveRange(q);
    const dateWhere = this.placedAtWhere(range);
    const [agg, byCategory, byCity] = await Promise.all([
      this.prisma.db.order.aggregate({
        where: { ...dateWhere, status: { in: PAID_STATUSES } },
        _sum: {
          buyerTotalCents: true,
          commissionCents: true,
          fulfillmentFeeCents: true,
        },
      }),
      this.revenueByCategory(q),
      this.revenueByCity(q),
    ]);
    return {
      totalRevenueCents: agg._sum.buyerTotalCents ?? 0,
      totalCommissionCents: agg._sum.commissionCents ?? 0,
      totalDeliveryFeeCents: agg._sum.fulfillmentFeeCents ?? 0,
      byCategory,
      byCity,
    };
  }

  // ---- revenue by category ----------------------------------------------

  async revenueByCategory(q: DashboardQueryDto): Promise<
    Array<{
      category: SellerCategory;
      orderCount: number;
      revenueCents: number;
      commissionCents: number;
    }>
  > {
    const range = this.resolveRange(q);
    const dateWhere = this.placedAtWhere(range);
    const categories: SellerCategory[] = [
      SellerCategory.FAIT_MAISON,
      SellerCategory.TRAITEUR,
      SellerCategory.RESTAURANT,
    ];

    const rows = await Promise.all(
      categories.map((category) =>
        this.prisma.db.order.aggregate({
          where: {
            ...dateWhere,
            status: { in: PAID_STATUSES },
            seller: { category },
          },
          _sum: { buyerTotalCents: true, commissionCents: true },
          _count: { _all: true },
        }),
      ),
    );

    return categories.map((category, i) => ({
      category,
      orderCount: rows[i]._count._all,
      revenueCents: rows[i]._sum.buyerTotalCents ?? 0,
      commissionCents: rows[i]._sum.commissionCents ?? 0,
    }));
  }

  // ---- revenue by city (delivery dropoff city) ---------------------------

  async revenueByCity(
    q: DashboardQueryDto,
  ): Promise<Array<{ city: string; orderCount: number; revenueCents: number }>> {
    const { from, to } = this.resolveRange(q);
    const lo = from ?? EPOCH;
    const hi = to ?? FAR_FUTURE;
    const statuses = [...PAID_STATUSES] as string[];

    const rows = await this.prisma.$queryRaw<
      Array<{ city: string; order_count: number; revenue_cents: bigint }>
    >`
      SELECT a.city AS city,
             COUNT(*)::int AS order_count,
             COALESCE(SUM(o."buyerTotalCents"), 0)::bigint AS revenue_cents
      FROM "Order" o
      JOIN "Address" a ON a.id = o."dropoffAddressId"
      WHERE o.status::text = ANY(${statuses})
        AND o."placedAt" BETWEEN ${lo} AND ${hi}
      GROUP BY a.city
      ORDER BY revenue_cents DESC;
    `;
    return rows.map((r) => ({
      city: r.city,
      orderCount: r.order_count,
      revenueCents: Number(r.revenue_cents),
    }));
  }

  // ---- recurring users (fixed last-7-days definition) --------------------

  /**
   * Count of distinct users who made ≥2 paid transactions (as buyer OR as
   * seller) in the last 7 days. Per the spec, this window is fixed and does
   * not follow the dashboard date filter.
   */
  async recurringUsersCount(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
    const statuses = [...PAID_STATUSES] as string[];
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      WITH buyers AS (
        SELECT "buyerId" AS user_id
        FROM "Order"
        WHERE status::text = ANY(${statuses}) AND "placedAt" >= ${sevenDaysAgo}
        GROUP BY "buyerId" HAVING COUNT(*) >= 2
      ),
      sellers AS (
        SELECT "sellerId" AS user_id
        FROM "Order"
        WHERE status::text = ANY(${statuses}) AND "placedAt" >= ${sevenDaysAgo}
        GROUP BY "sellerId" HAVING COUNT(*) >= 2
      )
      SELECT COUNT(*)::bigint AS count
      FROM (SELECT user_id FROM buyers UNION SELECT user_id FROM sellers) u;
    `;
    return Number(rows[0]?.count ?? 0);
  }

  // ---- mono users --------------------------------------------------------

  /**
   * Count of distinct users with exactly one paid transaction (as buyer or
   * as seller) within the selected window.
   */
  async monoUsersCount(range: ResolvedRange): Promise<number> {
    const lo = range.from ?? EPOCH;
    const hi = range.to ?? FAR_FUTURE;
    const statuses = [...PAID_STATUSES] as string[];
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      WITH buyers AS (
        SELECT "buyerId" AS user_id, COUNT(*) AS cnt
        FROM "Order"
        WHERE status::text = ANY(${statuses})
          AND "placedAt" BETWEEN ${lo} AND ${hi}
        GROUP BY "buyerId"
      ),
      sellers AS (
        SELECT "sellerId" AS user_id, COUNT(*) AS cnt
        FROM "Order"
        WHERE status::text = ANY(${statuses})
          AND "placedAt" BETWEEN ${lo} AND ${hi}
        GROUP BY "sellerId"
      )
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT user_id FROM buyers WHERE cnt = 1
        UNION
        SELECT user_id FROM sellers WHERE cnt = 1
      ) u;
    `;
    return Number(rows[0]?.count ?? 0);
  }

  /** Recurring users with their transaction counts (for targeting/listing). */
  async recurringUserIds(): Promise<string[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
    const statuses = [...PAID_STATUSES] as string[];
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      WITH buyers AS (
        SELECT "buyerId" AS user_id FROM "Order"
        WHERE status::text = ANY(${statuses}) AND "placedAt" >= ${sevenDaysAgo}
        GROUP BY "buyerId" HAVING COUNT(*) >= 2
      ),
      sellers AS (
        SELECT "sellerId" AS user_id FROM "Order"
        WHERE status::text = ANY(${statuses}) AND "placedAt" >= ${sevenDaysAgo}
        GROUP BY "sellerId" HAVING COUNT(*) >= 2
      )
      SELECT user_id FROM buyers UNION SELECT user_id FROM sellers;
    `;
    return rows.map((r) => r.user_id);
  }

  /** Mono users (all-time, exactly one paid transaction). For targeting. */
  async monoUserIds(): Promise<string[]> {
    const statuses = [...PAID_STATUSES] as string[];
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string }>>`
      WITH buyers AS (
        SELECT "buyerId" AS user_id, COUNT(*) AS cnt FROM "Order"
        WHERE status::text = ANY(${statuses}) GROUP BY "buyerId"
      ),
      sellers AS (
        SELECT "sellerId" AS user_id, COUNT(*) AS cnt FROM "Order"
        WHERE status::text = ANY(${statuses}) GROUP BY "sellerId"
      )
      SELECT user_id FROM buyers WHERE cnt = 1
      UNION
      SELECT user_id FROM sellers WHERE cnt = 1;
    `;
    return rows.map((r) => r.user_id);
  }

  /** Top sellers by paid revenue (for targeting + a dashboard table). */
  async topSellerIds(limit = 20): Promise<string[]> {
    const statuses = [...PAID_STATUSES] as string[];
    const rows = await this.prisma.$queryRaw<Array<{ seller_id: string }>>`
      SELECT "sellerId" AS seller_id, COALESCE(SUM("buyerTotalCents"), 0) AS revenue
      FROM "Order"
      WHERE status::text = ANY(${statuses})
      GROUP BY "sellerId"
      ORDER BY revenue DESC
      LIMIT ${limit};
    `;
    return rows.map((r) => r.seller_id);
  }
}
