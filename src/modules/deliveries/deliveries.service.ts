import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';

import { IssueSeverity } from '@common/enums/issue-severity.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { OrderStatus } from '@common/enums/order-status.enum';
import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { AuditService } from '@infrastructure/audit/audit.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { RedisService } from '@infrastructure/redis/redis.service';

import { NotificationsService } from '@modules/notifications/notifications.service';
import { OrdersService } from '@modules/orders/orders.service';
import { driverLocChannel } from '@modules/tracking/tracking.gateway';

import { DeliveryEnrichment } from './dto/delivery-response.dto';
import { DriverLocationDto } from './dto/driver-location.dto';
import { OnlineStatusDto } from './dto/online-status.dto';
import { ReportIssueDto } from './dto/report-issue.dto';

import type { Delivery, Order } from '@prisma/client';

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.EN_ROUTE_TO_PICKUP,
  DeliveryStatus.AT_PICKUP,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.EN_ROUTE_TO_DROPOFF,
  DeliveryStatus.AT_DROPOFF,
];

type DeliveryWithRelations = Delivery & {
  order: Pick<Order, 'orderNumber' | 'status' | 'fulfillmentFeeCents'> & {
    // neighborhood is nullable post-Phase-A — seller hasn't finished signup
    // would surface as null; not a problem for drivers since deliveries are
    // only created for sellers who can take orders (gate in orders.service).
    seller: { neighborhood: string | null };
    // Nullable on the Order model (PICKUP orders carry no dropoff), but in
    // practice always present here — deliveries are only created for
    // DELIVERY orders. Typed nullable to match Prisma; readers coalesce.
    dropoffAddress: { city: string; postalCode: string } | null;
  };
};

const DELIVERY_INCLUDE = {
  order: {
    select: {
      orderNumber: true,
      status: true,
      fulfillmentFeeCents: true,
      seller: { select: { neighborhood: true } },
      dropoffAddress: { select: { city: true, postalCode: true } },
    },
  },
} as const;

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  // -----------------------------------------------------------------------
  // Driver online toggle
  // -----------------------------------------------------------------------

  async setOnline(supabaseId: string, dto: OnlineStatusDto): Promise<void> {
    const driver = await this.assertDriver(supabaseId);

    // Dev fallback: in production a driver must have an admin-approved
    // KYC submission before going online. In NODE_ENV=development we
    // auto-promote any non-approved driver so the e2e demo doesn't
    // require running the admin KYC review flow for every fresh signup.
    if (dto.isOnline && driver.kycStatus !== KycStatus.Approved) {
      if (process.env.NODE_ENV === 'development') {
        await this.prisma.db.driverProfile.update({
          where: { userId: driver.userId },
          data: { kycStatus: KycStatus.Approved },
        });
        this.logger.debug(`[dev] auto-approved driver KYC for ${driver.userId}`);
      } else {
        throw new ForbiddenException('Driver KYC must be APPROVED before going online');
      }
    }

    await this.prisma.db.driverProfile.update({
      where: { userId: driver.userId },
      data: {
        isOnline: dto.isOnline,
        lastSeenAt: new Date(),
      },
    });

    // Persist last-known point as a denormalized PostGIS column. Real-time
    // location is broadcast via Redis (per schema comment); this is the
    // periodic flush for offline reads.
    if (dto.lat !== undefined && dto.lng !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE "DriverProfile"
        SET "lastKnownPoint" = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
        WHERE "userId" = ${driver.userId}
      `;
    }
  }

  /**
   * High-frequency driver position update. Persists `lastKnownPoint` as a
   * periodic flush and, when the driver has an active delivery, publishes
   * the position to Redis so TrackingGateway can fan it out to the buyer's
   * subscribed socket. Returns the deliveryId being broadcast on (if any),
   * useful for the driver app to confirm wiring.
   */
  async recordLocation(
    supabaseId: string,
    dto: DriverLocationDto,
  ): Promise<{ broadcast: boolean; deliveryId: string | null }> {
    const driver = await this.assertDriver(supabaseId);
    const now = new Date();

    await this.prisma.$executeRaw`
      UPDATE "DriverProfile"
      SET "lastKnownPoint" = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326),
          "lastSeenAt" = ${now}
      WHERE "userId" = ${driver.userId}
    `;

    const active = await this.prisma.db.delivery.findFirst({
      where: { driverId: driver.userId, status: { in: ACTIVE_DELIVERY_STATUSES } },
      select: { id: true },
      orderBy: { driverAssignedAt: 'desc' },
    });

    if (!active) return { broadcast: false, deliveryId: null };

    const payload = JSON.stringify({
      deliveryId: active.id,
      lat: dto.lat,
      lng: dto.lng,
      headingDeg: dto.headingDeg,
      speedMps: dto.speedMps,
      at: now.toISOString(),
    });
    try {
      await this.redis.client.publish(driverLocChannel(active.id), payload);
    } catch (err) {
      this.logger.warn(`location publish failed for ${active.id}: ${(err as Error).message}`);
    }
    return { broadcast: true, deliveryId: active.id };
  }

  // -----------------------------------------------------------------------
  // Driver-side reads
  // -----------------------------------------------------------------------

  /**
   * Available SEARCHING deliveries the driver can claim. Every online
   * driver sees every unclaimed job, ordered nearest-first (driver →
   * seller pickup), FIFO as the fallback/tiebreak. Whoever claims
   * first wins (atomic; losers get a 409).
   */
  async listAvailable(
    supabaseId: string,
    limit: number,
    offset: number,
  ): Promise<{
    items: Array<{ row: DeliveryWithRelations; enrichment: DeliveryEnrichment }>;
    hasMore: boolean;
  }> {
    const driver = await this.assertDriver(supabaseId);

    // Open dispatch: every unclaimed SEARCHING delivery is offered to
    // every online driver. Ordering is nearest-first — distance from
    // the calling driver's `lastKnownPoint` to the seller's pickup
    // point (`SellerProfile.location`), FIFO by `createdAt` as the
    // tiebreak and the fallback when either point is missing.
    //
    // Earlier this pinned each delivery to the single closest driver,
    // which (a) hid every job from all other online drivers and (b)
    // got stuck when that one driver declined — declines aren't
    // persisted, so the job had nobody else to fall to. Showing the
    // job to everyone + the atomic `claim` (409 on a lost race) gives
    // the same nearest-first feel without starving anyone; the client
    // tracks its own declines so a passed job advances to the next.
    const eligible = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT d.id
      FROM "Delivery" d
      JOIN "Order" o ON o.id = d."orderId"
      JOIN "SellerProfile" s ON s."userId" = o."sellerId"
      LEFT JOIN "DriverProfile" me ON me."userId" = ${driver.userId}
      WHERE d.status = 'SEARCHING'
        AND d."driverId" IS NULL
      ORDER BY
        CASE
          WHEN me."lastKnownPoint" IS NOT NULL AND s.location IS NOT NULL
          THEN me."lastKnownPoint" <-> s.location
        END ASC NULLS LAST,
        d."createdAt" ASC
      LIMIT ${limit + 1} OFFSET ${offset};
    `;

    // Matching visibility. debug level: drivers poll this frequently, so we
    // don't want it at log level — but it's here when diagnosing "driver is
    // online but sees no jobs" (count 0 = no SEARCHING delivery, i.e. seller
    // hasn't marked an order ready yet).
    this.logger.debug(
      `[lifecycle] driver ${driver.userId} available-poll → ${eligible.length} SEARCHING job(s) offered`,
    );

    if (eligible.length === 0) {
      return { items: [], hasMore: false };
    }

    const ids = eligible.map((r) => r.id);
    const rows = await this.prisma.db.delivery.findMany({
      where: { id: { in: ids } },
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    // Enrichment: PostGIS coords (which Prisma can't `select`) plus
    // seller name + dropoff full address + order total + item count
    // — everything the driver-app modal needs to render real data,
    // and `DeliveryRouteController` needs to route the map to the
    // actual seller pickup point.
    const enrichment = await this.loadDeliveryEnrichment(ids);

    const hasMore = ids.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: sliced.map((row) => ({
        row,
        enrichment: enrichment.get(row.id) ?? {
          pickupLat: null,
          pickupLng: null,
          pickupFullAddress: null,
          dropoffLat: null,
          dropoffLng: null,
          dropoffFullAddress: row.order.dropoffAddress?.city ?? '',
          sellerName: null,
          recipientName: null,
          orderTotalCents: row.order.fulfillmentFeeCents,
          placedAt: row.createdAt,
          itemCount: 0,
        },
      })),
      hasMore,
    };
  }

  /**
   * Single raw-SQL fetch for the geo + display fields the driver
   * modal needs. PostGIS columns (`SellerProfile.location`,
   * `Address.point`) aren't selectable through Prisma; this helper
   * unwraps them with `ST_X`/`ST_Y` and joins user + items in the
   * same trip to avoid an N+1.
   */
  private async loadDeliveryEnrichment(ids: string[]): Promise<Map<string, DeliveryEnrichment>> {
    if (ids.length === 0) return new Map();
    type Row = {
      delivery_id: string;
      pickup_lng: number | null;
      pickup_lat: number | null;
      dropoff_lng: number | null;
      dropoff_lat: number | null;
      dropoff_full_address: string;
      seller_first_name: string | null;
      seller_last_name: string | null;
      buyer_first_name: string | null;
      buyer_last_name: string | null;
      order_total_cents: number;
      placed_at: Date;
      item_count: number | bigint;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        d.id AS delivery_id,
        ST_X(s.location::geometry) AS pickup_lng,
        ST_Y(s.location::geometry) AS pickup_lat,
        ST_X(a.point::geometry) AS dropoff_lng,
        ST_Y(a.point::geometry) AS dropoff_lat,
        a."fullAddress" AS dropoff_full_address,
        u."firstName" AS seller_first_name,
        u."lastName" AS seller_last_name,
        b."firstName" AS buyer_first_name,
        b."lastName" AS buyer_last_name,
        o."buyerTotalCents" AS order_total_cents,
        o."placedAt" AS placed_at,
        (SELECT COALESCE(SUM(quantity), 0)
         FROM "OrderItem"
         WHERE "orderId" = o.id) AS item_count
      FROM "Delivery" d
      JOIN "Order" o ON o.id = d."orderId"
      JOIN "User" u ON u.id = o."sellerId"
      JOIN "User" b ON b.id = o."buyerId"
      JOIN "Address" a ON a.id = o."dropoffAddressId"
      JOIN "SellerProfile" s ON s."userId" = o."sellerId"
      WHERE d.id = ANY(${ids}::text[]);
    `;
    const out = new Map<string, DeliveryEnrichment>();
    for (const r of rows) {
      const sellerName = [r.seller_first_name, r.seller_last_name].filter(Boolean).join(' ').trim();
      const recipientName = [r.buyer_first_name, r.buyer_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      out.set(r.delivery_id, {
        pickupLat: r.pickup_lat,
        pickupLng: r.pickup_lng,
        pickupFullAddress: null,
        dropoffLat: r.dropoff_lat,
        dropoffLng: r.dropoff_lng,
        dropoffFullAddress: r.dropoff_full_address,
        sellerName: sellerName.length > 0 ? sellerName : null,
        recipientName: recipientName.length > 0 ? recipientName : null,
        orderTotalCents: r.order_total_cents,
        placedAt: r.placed_at,
        itemCount: typeof r.item_count === 'bigint' ? Number(r.item_count) : r.item_count,
      });
    }
    return out;
  }

  /** Driver's own deliveries (current + history). */
  async listMine(
    supabaseId: string,
    status: DeliveryStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<{ items: DeliveryWithRelations[]; hasMore: boolean }> {
    const driver = await this.assertDriver(supabaseId);

    const rows = await this.prisma.db.delivery.findMany({
      where: { driverId: driver.userId, ...(status ? { status } : {}) },
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      skip: offset,
    });
    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  async findById(supabaseId: string, deliveryId: string): Promise<DeliveryWithRelations> {
    const driver = await this.assertDriver(supabaseId);
    const delivery = await this.prisma.db.delivery.findUnique({
      where: { id: deliveryId },
      include: DELIVERY_INCLUDE,
    });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    // Either claim-able (no driver yet) or owned by this driver.
    if (delivery.driverId && delivery.driverId !== driver.userId) {
      throw new ForbiddenException("Cannot view another driver's delivery");
    }
    return delivery;
  }

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  /**
   * Atomic claim — first writer wins. UPDATE returns 0 affected rows if a
   * concurrent driver beat us to it; we surface that as 409.
   */
  async claim(supabaseId: string, deliveryId: string): Promise<DeliveryWithRelations> {
    const driver = await this.assertDriver(supabaseId);
    const isDev = process.env.NODE_ENV === 'development';

    if (driver.kycStatus !== KycStatus.Approved) {
      if (isDev) {
        await this.prisma.db.driverProfile.update({
          where: { userId: driver.userId },
          data: { kycStatus: KycStatus.Approved },
        });
        this.logger.debug(`[dev] auto-approved driver KYC for claim by ${driver.userId}`);
      } else {
        throw new ForbiddenException('Driver KYC must be APPROVED to claim deliveries');
      }
    }
    if (!driver.stripeOnboardingCompleted) {
      if (isDev) {
        await this.prisma.db.driverProfile.update({
          where: { userId: driver.userId },
          data: { stripeOnboardingCompleted: true },
        });
        this.logger.debug(`[dev] auto-completed Stripe Connect for ${driver.userId}`);
      } else {
        throw new ForbiddenException(
          'Complete Stripe Connect onboarding before claiming deliveries',
        );
      }
    }

    // Race-safe atomic claim.
    const updated = await this.prisma.$executeRaw`
      UPDATE "Delivery"
      SET "driverId" = ${driver.userId},
          "status" = 'ASSIGNED'::"DeliveryStatus",
          "driverAssignedAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "id" = ${deliveryId}
        AND "status" = 'SEARCHING'::"DeliveryStatus"
        AND "driverId" IS NULL
    `;
    if (updated === 0) {
      throw new ConflictException('Delivery is no longer available');
    }
    this.logger.log(
      `[lifecycle] delivery ${deliveryId} claimed → ASSIGNED to driver ${driver.userId}`,
    );
    const delivery = await this.loadDelivery(deliveryId);
    // Buyer push: a driver is now assigned (self-wrapped; never throws).
    await this.notifications.notifyDeliveryEvent(
      delivery.orderId,
      deliveryId,
      'delivery_assigned',
      { buyer: true },
    );
    return delivery;
  }

  /** ASSIGNED → AT_PICKUP. Driver has reached the seller. */
  async arriveAtPickup(supabaseId: string, deliveryId: string): Promise<DeliveryWithRelations> {
    const delivery = await this.transition(supabaseId, deliveryId, {
      from: [DeliveryStatus.ASSIGNED],
      to: DeliveryStatus.AT_PICKUP,
    });
    // Buyer + seller: the driver has arrived at the seller.
    await this.notifications.notifyDeliveryEvent(delivery.orderId, deliveryId, 'driver_at_pickup', {
      buyer: true,
      seller: true,
    });
    return delivery;
  }

  /**
   * AT_PICKUP → PICKED_UP. Driver has the food. Mirrors Order to
   * IN_DELIVERY (we collapse Order's transient PICKED_UP and IN_DELIVERY
   * into a single "in delivery" state for the buyer's UI).
   */
  async confirmPickup(supabaseId: string, deliveryId: string): Promise<DeliveryWithRelations> {
    const driver = await this.assertDriver(supabaseId);
    const delivery = await this.loadDeliveryForDriver(deliveryId, driver.userId);

    if (delivery.status !== DeliveryStatus.AT_PICKUP) {
      throw new ConflictException(
        `Delivery is in ${delivery.status}; confirm-pickup requires AT_PICKUP`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: DeliveryStatus.PICKED_UP, pickedUpAt: new Date() },
      });
      await tx.order.update({
        where: { id: delivery.orderId },
        data: { status: 'IN_DELIVERY' },
      });
    });
    // Buyer's tracking stepper jumps to "En route" the moment this lands.
    await this.orders.publishOrderStatusChanged(delivery.orderId, OrderStatus.InDelivery);
    // Buyer push: order picked up, now en route.
    await this.notifications.notifyDeliveryEvent(delivery.orderId, deliveryId, 'order_picked_up', {
      buyer: true,
    });

    return this.loadDelivery(deliveryId);
  }

  /**
   * PICKED_UP → DELIVERED. Order → DELIVERED. Triggers Stripe transfers
   * to seller and driver via OrdersService.confirmDeliveredByDriver.
   */
  async confirmDelivery(supabaseId: string, deliveryId: string): Promise<DeliveryWithRelations> {
    const driver = await this.assertDriver(supabaseId);
    const delivery = await this.loadDeliveryForDriver(deliveryId, driver.userId);

    if (delivery.status !== DeliveryStatus.PICKED_UP) {
      throw new ConflictException(
        `Delivery is in ${delivery.status}; confirm-delivery requires PICKED_UP`,
      );
    }

    await this.prisma.db.delivery.update({
      where: { id: deliveryId },
      data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
    });

    // Order transition + payout. Idempotent in OrdersService.
    await this.orders.confirmDeliveredByDriver(delivery.orderId);

    // Buyer + seller push: delivered.
    await this.notifications.notifyDeliveryEvent(
      delivery.orderId,
      deliveryId,
      'delivery_completed',
      { buyer: true, seller: true },
    );

    return this.loadDelivery(deliveryId);
  }

  // -----------------------------------------------------------------------
  // Issues
  // -----------------------------------------------------------------------

  async reportIssue(
    supabaseId: string,
    deliveryId: string,
    dto: ReportIssueDto,
  ): Promise<{ id: string; severity: IssueSeverity }> {
    const driver = await this.assertDriver(supabaseId);
    const delivery = await this.loadDeliveryForDriver(deliveryId, driver.userId);

    const issue = await this.prisma.db.orderIssue.create({
      data: {
        id: generateUlid(),
        deliveryId: delivery.id,
        driverId: driver.userId,
        issueCode: dto.issueCode,
        severity: dto.severity,
        stageWhenReported: dto.stageWhenReported,
        freeText: dto.freeText ?? null,
      },
    });

    // ABORT severity flags for admin intervention but doesn't auto-cancel
    // (refund decisions are a human call). Log + persist for forensics.
    if (dto.severity === IssueSeverity.Abort) {
      this.logger.warn(
        `Driver ${driver.userId} filed ABORT issue on delivery ${deliveryId} (order ${delivery.orderId}, code ${dto.issueCode})`,
      );
      await this.audit.record({
        actorId: driver.userId,
        action: 'delivery.issue_abort',
        targetType: 'OrderIssue',
        targetId: issue.id,
        metadata: {
          deliveryId,
          orderId: delivery.orderId,
          issueCode: dto.issueCode,
          stageWhenReported: dto.stageWhenReported,
          freeText: dto.freeText ?? null,
        },
      });
    }

    return { id: issue.id, severity: issue.severity as IssueSeverity };
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async transition(
    supabaseId: string,
    deliveryId: string,
    spec: { from: DeliveryStatus[]; to: DeliveryStatus },
  ): Promise<DeliveryWithRelations> {
    const driver = await this.assertDriver(supabaseId);
    const delivery = await this.loadDeliveryForDriver(deliveryId, driver.userId);

    if (!spec.from.includes(delivery.status)) {
      throw new ConflictException(
        `Delivery is in ${delivery.status}; transition to ${spec.to} requires one of [${spec.from.join(', ')}]`,
      );
    }

    await this.prisma.db.delivery.update({
      where: { id: deliveryId },
      data: { status: spec.to },
    });
    return this.loadDelivery(deliveryId);
  }

  private async assertDriver(supabaseId: string): Promise<{
    userId: string;
    kycStatus: KycStatus;
    stripeOnboardingCompleted: boolean;
  }> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true, driverProfile: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role !== UserRole.Driver || !user.driverProfile) {
      throw new ForbiddenException('Only drivers can act on deliveries');
    }
    return {
      userId: user.driverProfile.userId,
      kycStatus: user.driverProfile.kycStatus as KycStatus,
      stripeOnboardingCompleted: user.driverProfile.stripeOnboardingCompleted,
    };
  }

  private async loadDeliveryForDriver(
    deliveryId: string,
    driverUserId: string,
  ): Promise<{ id: string; orderId: string; status: DeliveryStatus; driverId: string | null }> {
    const delivery = await this.prisma.db.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, orderId: true, status: true, driverId: true },
    });
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    if (delivery.driverId !== driverUserId) {
      throw new ForbiddenException("Cannot act on another driver's delivery");
    }
    return delivery;
  }

  private async loadDelivery(deliveryId: string): Promise<DeliveryWithRelations> {
    const row = await this.prisma.db.delivery.findUnique({
      where: { id: deliveryId },
      include: DELIVERY_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Delivery not found');
    }
    return row;
  }
}
