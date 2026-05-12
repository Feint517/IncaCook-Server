import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import type { Delivery, Order } from '@prisma/client';

import { IssueSeverity } from '@common/enums/issue-severity.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { AuditService } from '@infrastructure/audit/audit.service';
import { PrismaService } from '@infrastructure/database/prisma.service';

import { OrdersService } from '@modules/orders/orders.service';

import { OnlineStatusDto } from './dto/online-status.dto';
import { ReportIssueDto } from './dto/report-issue.dto';

type DeliveryWithRelations = Delivery & {
  order: Pick<Order, 'orderNumber' | 'status' | 'fulfillmentFeeCents'> & {
    // neighborhood is nullable post-Phase-A — seller hasn't finished signup
    // would surface as null; not a problem for drivers since deliveries are
    // only created for sellers who can take orders (gate in orders.service).
    seller: { neighborhood: string | null };
    dropoffAddress: { city: string; postalCode: string };
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
  ) {}

  // -----------------------------------------------------------------------
  // Driver online toggle
  // -----------------------------------------------------------------------

  async setOnline(supabaseId: string, dto: OnlineStatusDto): Promise<void> {
    const driver = await this.assertDriver(supabaseId);

    if (dto.isOnline && driver.kycStatus !== KycStatus.Approved) {
      throw new ForbiddenException(
        'Driver KYC must be APPROVED before going online',
      );
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

  // -----------------------------------------------------------------------
  // Driver-side reads
  // -----------------------------------------------------------------------

  /**
   * Available SEARCHING deliveries the driver can claim. v1: FIFO by
   * createdAt, no geo filter. Adding distance-based scoring is a v2
   * concern (smart matching).
   */
  async listAvailable(
    supabaseId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: DeliveryWithRelations[]; hasMore: boolean }> {
    await this.assertDriver(supabaseId);

    const rows = await this.prisma.db.delivery.findMany({
      where: { status: DeliveryStatus.SEARCHING, driverId: null },
      include: DELIVERY_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      skip: offset,
    });
    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
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

  async findById(
    supabaseId: string,
    deliveryId: string,
  ): Promise<DeliveryWithRelations> {
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
      throw new ForbiddenException('Cannot view another driver\'s delivery');
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
    if (driver.kycStatus !== KycStatus.Approved) {
      throw new ForbiddenException('Driver KYC must be APPROVED to claim deliveries');
    }
    if (!driver.stripeOnboardingCompleted) {
      throw new ForbiddenException(
        'Complete Stripe Connect onboarding before claiming deliveries',
      );
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
    return this.loadDelivery(deliveryId);
  }

  /** ASSIGNED → AT_PICKUP. Driver has reached the seller. */
  async arriveAtPickup(supabaseId: string, deliveryId: string): Promise<DeliveryWithRelations> {
    return this.transition(supabaseId, deliveryId, {
      from: [DeliveryStatus.ASSIGNED],
      to: DeliveryStatus.AT_PICKUP,
    });
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
      throw new ForbiddenException('Cannot act on another driver\'s delivery');
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
