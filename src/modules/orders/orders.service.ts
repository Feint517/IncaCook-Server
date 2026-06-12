import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AddressKind, Prisma } from '@prisma/client';

import { DeliveryTiming } from '@common/enums/delivery-timing.enum';
import { FulfillmentChoice } from '@common/enums/fulfillment-choice.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { OrderStatus } from '@common/enums/order-status.enum';
import { generateOrderCode, generateUlid } from '@common/utils/code-generator.util';

import { AuditService } from '@infrastructure/audit/audit.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { recordTermsAcceptance } from '@modules/compliance/charters/record-terms-acceptance.util';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { isSubscriptionActive } from '@modules/subscriptions/subscription.util';
import { CreateAddressDto } from '@modules/users/dto/create-address.dto';
import { WalletService } from '@modules/wallets/wallets.service';

import { CreateOrderItemDto } from './dto/create-order-item.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderTrackingResponseDto } from './dto/tracking-response.dto';

import type { Address, Order, OrderItem, OrderItemAddOn } from '@prisma/client';
import type Stripe from 'stripe';

type OrderWithEverything = Order & {
  items: Array<OrderItem & { addOns: OrderItemAddOn[] }>;
  // Null for PICKUP orders — no delivery address.
  dropoffAddress: Address | null;
};

type Tx = Prisma.TransactionClient;

/** Premium sellers pay 25%, everyone else 30%. Mirrors the env defaults. */
const COMMISSION_RATE_BPS_STANDARD = 3000;
const COMMISSION_RATE_BPS_PREMIUM = 2500;
// Commission floor: 1 € (100 cents) per the client spec — commission is
// never less than this regardless of subtotal × rate.
const COMMISSION_MIN_CENTS = 100;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Best-effort fanout of an order's new status to anyone subscribed to
   * the tracking socket for this order. Used by every status-changing
   * code path on both sides (seller + driver) so the buyer's tracking
   * stepper advances live and the "delivered" popup can fire.
   * Failures are swallowed — losing one status event isn't worth
   * aborting the underlying business operation.
   */
  async publishOrderStatusChanged(orderId: string, status: OrderStatus): Promise<void> {
    try {
      const channel = `order:${orderId}:status`;
      const payload = JSON.stringify({
        orderId,
        status,
        at: new Date().toISOString(),
      });
      await this.redis.client.publish(channel, payload);
    } catch (err) {
      this.logger.warn(`status publish failed for ${orderId}: ${(err as Error).message}`);
    }
  }

  /**
   * Creates a PENDING order + Stripe PaymentIntent. Idempotency is the
   * caller's responsibility (controller wraps with IdempotencyService).
   *
   * Flow:
   *   1. Validate buyer + cart (single seller, KYC, listing live, addons match)
   *   2. Resolve dropoff address (existing or new)
   *   3. Ensure Stripe Customer for the buyer
   *   4. DB transaction:
   *        a. Atomic decrement on each Listing's portionsLeft
   *        b. Insert Order + OrderItems + OrderItemAddOns
   *   5. Create Stripe PaymentIntent (separate-charges pattern: NO transfer_data,
   *      NO application_fee_amount). Funds land on platform balance until
   *      Slice B/C transfers to seller after delivery.
   *   6. Update Order.stripePaymentIntentId. Webhook self-heals if this
   *      step fails.
   */
  async createOrder(
    supabaseId: string,
    dto: CreateOrderDto,
  ): Promise<{ order: OrderWithEverything; paymentIntentClientSecret: string }> {
    // ---- 1. Resolve buyer ----
    const buyer = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: { buyerProfile: true },
    });
    if (!buyer) {
      throw new NotFoundException('User profile not found');
    }
    if (!buyer.buyerProfile) {
      throw new BadRequestException('Complete buyer profile before placing orders');
    }
    if (buyer.deletedAt) {
      throw new ForbiddenException('Deleted users cannot place orders');
    }

    // CGU/CGV must be explicitly accepted at each purchase (client spec).
    if (dto.termsAccepted !== true) {
      throw new BadRequestException("Vous devez accepter les CGU/CGV avant d'acheter.");
    }

    // ---- 2. Validate cart ----
    const { listings, addOns, sellerId, seller } = await this.loadAndValidateCart(dto.items);

    // ---- 3. Validate scheduling ----
    if (dto.deliveryTiming === DeliveryTiming.Scheduled && !dto.scheduledAt) {
      throw new BadRequestException('scheduledAt is required when deliveryTiming = SCHEDULED');
    }
    if (dto.deliveryTiming !== DeliveryTiming.Scheduled && dto.scheduledAt) {
      throw new BadRequestException('scheduledAt is only valid with deliveryTiming = SCHEDULED');
    }

    // ---- 4. Validate fulfillment choice against seller capabilities ----
    if (
      dto.fulfillmentChoice === FulfillmentChoice.Delivery &&
      !listings.every((l) => l.fulfillment === 'DELIVERY' || l.fulfillment === 'BOTH')
    ) {
      throw new BadRequestException('At least one item is not available for delivery');
    }
    if (
      dto.fulfillmentChoice === FulfillmentChoice.Pickup &&
      !listings.every((l) => l.fulfillment === 'PICKUP' || l.fulfillment === 'BOTH')
    ) {
      throw new BadRequestException('At least one item is not available for pickup');
    }

    // ---- 5. Resolve drop-off address (DELIVERY only) ----
    // PICKUP orders have no delivery address — the buyer collects from
    // the seller — so we skip resolution and store a null dropoff.
    const dropoffAddressId =
      dto.fulfillmentChoice === FulfillmentChoice.Delivery
        ? await this.resolveDropoffAddress(buyer.id, dto)
        : null;

    // ---- 6. Compute totals ----
    const totals = this.computeTotals(dto.items, listings, addOns, seller, dto.fulfillmentChoice);

    // ---- 7. Ensure Stripe Customer (before DB write so we don't strand orders) ----
    const stripeCustomerId = await this.ensureStripeCustomer(
      buyer.id,
      buyer.email,
      buyer.stripeCustomerId,
    );

    // ---- 8. DB transaction: decrement inventory + insert order ----
    const orderId = generateUlid();
    const orderNumber = generateOrderCode();
    // The atomic-decrement helper throws ConflictException with a clear listing
    // name on stock-out. Other transaction errors bubble up as-is.
    const createdOrder: OrderWithEverything = await this.prisma.$transaction(async (tx) => {
      await this.atomicDecrementInventory(tx, dto.items, listings);
      await this.insertOrder(tx, {
        orderId,
        orderNumber,
        buyerId: buyer.id,
        sellerId,
        dropoffAddressId,
        dto,
        totals,
        listings,
        addOns,
      });
      return await this.loadOrder(tx, orderId);
    });

    // Durable CGU/CGV consent record (best-effort; never blocks the order).
    await recordTermsAcceptance(this.prisma, buyer.id);

    // ---- 9. Create PaymentIntent (separate-charges pattern) ----
    let pi: Pick<Stripe.PaymentIntent, 'id' | 'client_secret'>;
    try {
      pi = await this.stripe.client.paymentIntents.create({
        amount: totals.buyerTotalCents,
        currency: 'eur',
        customer: stripeCustomerId,
        // Lets the Stripe SDK Payment Sheet pick from the buyer's saved
        // payment methods + card-on-file + Apple Pay / Google Pay.
        automatic_payment_methods: { enabled: true },
        metadata: {
          orderId,
          sellerId,
          buyerId: buyer.id,
          // Captured for the future transfer step (Slice B/C).
          commissionCents: String(totals.commissionCents),
          sellerEarningsCents: String(totals.sellerEarningsCents),
        },
      });
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        // Dev fallback: paired with the dev customer fallback above.
        // We need a non-empty client_secret so the response shape stays
        // valid; the dev auto-confirm below skips the real Stripe
        // webhook entirely.
        this.logger.warn(
          `[dev] PaymentIntent creation failed for ${orderId} (${(err as Error).message}); using local placeholder`,
        );
        pi = {
          id: `pi_dev_${orderId}`,
          client_secret: `pi_dev_${orderId}_secret_devbypass`,
        };
      } else {
        this.logger.error(
          `Stripe PaymentIntent creation failed for order ${orderId}: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException('Payment provider unavailable');
      }
    }

    // ---- 10. Backfill the PaymentIntent ID. Webhook self-heals if this fails. ----
    try {
      await this.prisma.db.order.update({
        where: { id: orderId },
        data: { stripePaymentIntentId: pi.id },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to persist stripePaymentIntentId on order ${orderId} — webhook will self-heal via metadata.orderId: ${(err as Error).message}`,
      );
    }

    if (!pi.client_secret) {
      throw new ServiceUnavailableException('PaymentIntent missing client_secret');
    }

    // The order stays PENDING here. It only advances to CONFIRMED *after*
    // the payment actually succeeds — either via the buyer-triggered,
    // server-verified `confirmPaymentForBuyer` (called by the app right
    // after the card is charged) or, as a reliability backstop, Stripe's
    // `payment_intent.succeeded` webhook. This guarantees a seller only
    // ever sees paid orders in "Demandes de commande".
    return { order: createdOrder, paymentIntentClientSecret: pi.client_secret };
  }

  /**
   * Buyer-triggered, server-verified payment confirmation. The app calls
   * this the moment the Stripe Payment Sheet / card confirmation succeeds.
   * We re-check the PaymentIntent with Stripe (never trust the client) and
   * only then flip the order PENDING → CONFIRMED, so it reaches the
   * seller. Idempotent — orders already past PENDING are returned as-is.
   * The webhook performs the same transition asynchronously as a backstop.
   */
  async confirmPaymentForBuyer(supabaseId: string, orderId: string): Promise<OrderWithEverything> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User profile not found');

    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        stripePaymentIntentId: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId !== user.id) {
      throw new ForbiddenException("Cannot confirm another user's order");
    }

    if (order.status === OrderStatus.Pending) {
      const paid = await this.isPaymentSucceeded(order.stripePaymentIntentId);
      if (!paid) {
        throw new ConflictException('Payment has not completed for this order');
      }
      await this.prisma.db.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.Confirmed, confirmedAt: new Date() },
      });
      await this.publishOrderStatusChanged(orderId, OrderStatus.Confirmed);
      this.logger.log(
        `[lifecycle] order ${orderId} payment confirmed → CONFIRMED (seller=${order.sellerId})`,
      );
      // Payment is now verified-confirmed: tell the seller. Guarded inside
      // the PENDING→CONFIRMED block so it fires exactly once (the webhook
      // backstop sees CONFIRMED and skips), and wrapped so a push failure
      // never rolls back a successful payment confirmation (notifyOrderPaid
      // swallows its own errors).
      await this.notifications.notifyOrderPaid(order.sellerId, orderId);
    }

    return this.findOrderWithRelations(orderId);
  }

  /**
   * True when the order's PaymentIntent has succeeded on Stripe. A dev
   * placeholder PI id (or none) short-circuits to true only in
   * development, so the local demo still advances when payments aren't
   * fully wired.
   */
  private async isPaymentSucceeded(paymentIntentId: string | null): Promise<boolean> {
    if (!paymentIntentId || paymentIntentId.startsWith('pi_dev_')) {
      return process.env.NODE_ENV === 'development';
    }
    try {
      const pi = await this.stripe.client.paymentIntents.retrieve(paymentIntentId);
      return pi.status === 'succeeded';
    } catch (err) {
      this.logger.warn(
        `PaymentIntent retrieve failed for ${paymentIntentId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Order details. Buyer can fetch their own; seller can fetch their own. */
  async findById(supabaseId: string, orderId: string): Promise<OrderWithEverything> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { addOns: true } },
        dropoffAddress: true,
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.buyerId !== user.id && order.sellerId !== user.id) {
      throw new ForbiddenException("Cannot view another user's order");
    }
    return order;
  }

  /**
   * Map-tracking snapshot: real pickup (seller) + dropoff (client)
   * coordinates, the assigned driver's last-known point, and the
   * statuses that decide which leg's route to draw. Readable by the
   * buyer, the seller, or the assigned driver. PostGIS points come via
   * raw SQL (Prisma can't `select` the geography columns).
   *
   * This is the initial frame; live driver movement then streams over
   * the `/tracking` socket — see TrackingGateway / `driver:location`.
   */
  async getTracking(supabaseId: string, orderId: string): Promise<OrderTrackingResponseDto> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User profile not found');

    type Row = {
      buyer_id: string;
      seller_id: string;
      order_status: string;
      fulfillment_choice: string;
      delivery_id: string | null;
      delivery_status: string | null;
      driver_id: string | null;
      pickup_lng: number | null;
      pickup_lat: number | null;
      dropoff_lng: number | null;
      dropoff_lat: number | null;
      driver_lng: number | null;
      driver_lat: number | null;
      driver_first_name: string | null;
      driver_last_name: string | null;
      driver_avatar_path: string | null;
      driver_phone: string | null;
    };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        o."buyerId"  AS buyer_id,
        o."sellerId" AS seller_id,
        o.status     AS order_status,
        o."fulfillmentChoice"::text AS fulfillment_choice,
        ST_X(s.location::geometry) AS pickup_lng,
        ST_Y(s.location::geometry) AS pickup_lat,
        ST_X(a.point::geometry)    AS dropoff_lng,
        ST_Y(a.point::geometry)    AS dropoff_lat,
        d.id        AS delivery_id,
        d.status    AS delivery_status,
        d."driverId" AS driver_id,
        ST_X(dp."lastKnownPoint"::geometry) AS driver_lng,
        ST_Y(dp."lastKnownPoint"::geometry) AS driver_lat,
        du."firstName"  AS driver_first_name,
        du."lastName"   AS driver_last_name,
        du."avatarPath" AS driver_avatar_path,
        du.phone        AS driver_phone
      FROM "Order" o
      JOIN "SellerProfile" s ON s."userId" = o."sellerId"
      LEFT JOIN "Address" a ON a.id = o."dropoffAddressId"
      LEFT JOIN LATERAL (
        SELECT dd.id, dd.status, dd."driverId"
        FROM "Delivery" dd
        WHERE dd."orderId" = o.id
        ORDER BY dd."createdAt" DESC
        LIMIT 1
      ) d ON TRUE
      LEFT JOIN "DriverProfile" dp ON dp."userId" = d."driverId"
      LEFT JOIN "User" du ON du.id = d."driverId"
      WHERE o.id = ${orderId};
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException('Order not found');

    const isParty =
      user.id === row.buyer_id ||
      user.id === row.seller_id ||
      (row.driver_id != null && user.id === row.driver_id);
    if (!isParty) {
      throw new ForbiddenException("Cannot track another user's order");
    }

    const point = (lat: number | null, lng: number | null): { lat: number; lng: number } | null =>
      lat != null && lng != null ? { lat, lng } : null;

    return {
      orderStatus: row.order_status,
      fulfillmentChoice: row.fulfillment_choice,
      deliveryStatus: row.delivery_status,
      deliveryId: row.delivery_id,
      pickup: point(row.pickup_lat, row.pickup_lng),
      dropoff: point(row.dropoff_lat, row.dropoff_lng),
      driver: point(row.driver_lat, row.driver_lng),
      // Identity appears as soon as a driver is assigned (driverId set),
      // independent of whether they've pushed a location fix yet.
      driverInfo:
        row.driver_id != null
          ? {
              firstName: row.driver_first_name ?? '',
              lastName: row.driver_last_name ?? '',
              avatarPath: row.driver_avatar_path,
              phone: row.driver_phone,
            }
          : null,
    };
  }

  async listForBuyer(
    supabaseId: string,
    status: OrderStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<{ items: OrderWithEverything[]; hasMore: boolean }> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    return this.listOrders({ buyerId: user.id }, status, limit, offset);
  }

  async listForSeller(
    supabaseId: string,
    status: OrderStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<{ items: OrderWithEverything[]; hasMore: boolean }> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    return this.listOrders({ sellerId: user.id }, status, limit, offset);
  }

  // -----------------------------------------------------------------------
  // Slice B — seller-side lifecycle transitions
  // -----------------------------------------------------------------------

  /** CONFIRMED → PREPARING. Seller has accepted and started cooking. */
  async startPreparing(supabaseId: string, orderId: string): Promise<OrderWithEverything> {
    const order = await this.transitionAsSeller(supabaseId, orderId, {
      from: [OrderStatus.Confirmed],
      to: OrderStatus.Preparing,
    });
    // Best-effort buyer push (self-wrapped; never breaks the transition).
    await this.notifications.notifyOrderStatus(orderId, 'order_preparing');
    return order;
  }

  /**
   * PREPARING → READY. Food is ready for pickup or driver dispatch.
   *
   * For DELIVERY orders, this also creates a `Delivery` row with
   * `status=SEARCHING` so drivers can claim it. PICKUP orders don't get
   * a Delivery (the seller hands off directly via `confirm-pickup`).
   */
  async markReady(supabaseId: string, orderId: string): Promise<OrderWithEverything> {
    const sellerId = await this.assertSellerUser(supabaseId);
    const existing = await this.loadOrderForSellerAction(orderId, sellerId);

    if (existing.status !== OrderStatus.Preparing) {
      throw new ConflictException(`Order is in ${existing.status}; mark-ready requires PREPARING`);
    }

    let newDeliveryId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.Ready, readyAt: new Date() },
      });

      // Auto-spawn the delivery for DELIVERY orders. The atomic claim in
      // DeliveriesService.claim handles the race when multiple drivers
      // try to grab it.
      if (existing.fulfillmentChoice === FulfillmentChoice.Delivery) {
        newDeliveryId = generateUlid();
        await tx.delivery.create({
          data: {
            id: newDeliveryId,
            orderId,
            // status defaults to UNASSIGNED in the enum's first slot;
            // we want SEARCHING ("actively looking for a driver") which
            // is the live-broadcast state.
            status: 'SEARCHING',
          },
        });
      }
    });

    await this.publishOrderStatusChanged(orderId, OrderStatus.Ready);
    // Best-effort pushes (self-wrapped; never break the mark-ready commit).
    await this.notifications.notifyOrderStatus(orderId, 'order_ready');
    if (existing.fulfillmentChoice === FulfillmentChoice.Delivery) {
      this.logger.log(
        `[lifecycle] delivery created (SEARCHING) for order ${orderId} — now broadcast to online drivers`,
      );
      if (newDeliveryId) {
        await this.notifications.notifyDeliveryAvailable(orderId, newDeliveryId);
      }
    }
    return this.findOrderWithRelations(orderId);
  }

  /**
   * READY → DELIVERED for PICKUP orders only. Buyer has arrived and taken
   * the food; the seller confirms. For DELIVERY orders this is the
   * driver's responsibility (Slice C).
   */
  async confirmPickup(supabaseId: string, orderId: string): Promise<OrderWithEverything> {
    // PICKUP completion is symmetric: either party (seller handing the
    // food over OR buyer who just took it) can flip the order to
    // DELIVERED. Whichever taps first wins; the state machine is
    // idempotent enough that a duplicate tap is a no-op conflict.
    const callerId = await this.assertSellerUser(supabaseId);
    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        sellerId: true,
        buyerId: true,
        status: true,
        fulfillmentChoice: true,
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.sellerId !== callerId && order.buyerId !== callerId) {
      throw new ForbiddenException('Only the buyer or seller of the order can confirm pickup');
    }

    if (order.fulfillmentChoice !== FulfillmentChoice.Pickup) {
      throw new BadRequestException(
        'confirm-pickup is only valid for PICKUP orders; DELIVERY uses the driver flow',
      );
    }
    if (order.status !== OrderStatus.Ready) {
      throw new ConflictException(`Order is in ${order.status}; confirm-pickup requires READY`);
    }

    await this.prisma.db.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.Delivered },
    });
    await this.publishOrderStatusChanged(orderId, OrderStatus.Delivered);

    // Release seller funds. PICKUP has no driver leg → no driver transfer.
    await this.releaseFundsForCompletedOrder(orderId);

    return this.findOrderWithRelations(orderId);
  }

  /**
   * Marks the order as DELIVERED on behalf of the driver and releases
   * funds. Called by DeliveriesService when a driver confirms delivery.
   * Skips the Order transition if it's already DELIVERED (idempotent
   * across retried webhook deliveries / driver double-taps).
   */
  async confirmDeliveredByDriver(orderId: string): Promise<OrderWithEverything> {
    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: { status: true, fulfillmentChoice: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.fulfillmentChoice !== FulfillmentChoice.Delivery) {
      throw new BadRequestException(
        'confirm-delivery is only valid for DELIVERY orders; PICKUP uses the seller flow',
      );
    }

    if (order.status !== OrderStatus.Delivered) {
      await this.prisma.db.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.Delivered },
      });
      await this.publishOrderStatusChanged(orderId, OrderStatus.Delivered);
    }

    await this.releaseFundsForCompletedOrder(orderId);
    return this.findOrderWithRelations(orderId);
  }

  /**
   * On completion (delivery confirmed / reception validated), credit the
   * internal wallet ledger — seller net + driver fee + platform commission.
   * Money is NOT transferred here: actual Stripe Connect payouts happen only
   * on withdrawal (balance >= 50 €), see WalletService. Idempotent: a
   * duplicate completion or webhook can never double-credit (unique
   * `(orderId, userId, type)` + skipDuplicates in the ledger).
   *
   * Cancelled / refunded orders never reach here with a payable status, so
   * no credit is booked; disputed orders are credited HELD (not payable).
   */
  private async releaseFundsForCompletedOrder(orderId: string): Promise<void> {
    await this.wallet.creditForCompletedOrder(orderId);
  }

  /**
   * Cancel an order from CONFIRMED, PREPARING, or READY. Atomic:
   *   1. Restore inventory (idempotent via inventoryRestored flag)
   *   2. Mark order CANCELLED with reason
   * Then (outside transaction) issue a Stripe refund — full amount, since
   * we collected via separate-charges so the entire amount is sitting on
   * our platform balance.
   *
   * Refund failure leaves the order in CANCELLED state with a null
   * stripeRefundId; admin tooling can backfill (TODO: retry job).
   */
  async cancelAsSeller(
    supabaseId: string,
    orderId: string,
    reason: string,
  ): Promise<OrderWithEverything> {
    const sellerId = await this.assertSellerUser(supabaseId);
    const existing = await this.loadOrderForSellerAction(orderId, sellerId);

    const cancellableFrom: OrderStatus[] = [
      OrderStatus.Confirmed,
      OrderStatus.Preparing,
      OrderStatus.Ready,
    ];
    if (!cancellableFrom.includes(existing.status as OrderStatus)) {
      throw new ConflictException(
        `Order is in ${existing.status}; cancellation is allowed from CONFIRMED, PREPARING, or READY`,
      );
    }

    // Step 1: cancel + restore inventory (transactional, idempotent).
    await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          inventoryRestored: true,
          items: { select: { listingId: true, quantity: true } },
        },
      });
      if (!fresh) {
        throw new NotFoundException('Order not found');
      }
      if (!cancellableFrom.includes(fresh.status as OrderStatus)) {
        // Lost a race with another action (probably the payment_failed
        // webhook). Treat as no-op.
        return;
      }

      if (!fresh.inventoryRestored) {
        const restoreByListing = new Map<string, number>();
        for (const item of fresh.items) {
          restoreByListing.set(
            item.listingId,
            (restoreByListing.get(item.listingId) ?? 0) + item.quantity,
          );
        }
        for (const [listingId, qty] of restoreByListing) {
          await tx.$executeRaw`
            UPDATE "Listing"
            SET "portionsLeft" = "portionsLeft" + ${qty}
            WHERE "id" = ${listingId}
          `;
        }
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.Cancelled,
          cancelledAt: new Date(),
          cancellationReason: reason,
          inventoryRestored: true,
        },
      });
    });

    await this.audit.record({
      actorId: sellerId,
      action: 'order.cancel_by_seller',
      targetType: 'Order',
      targetId: orderId,
      metadata: { reason, fromStatus: existing.status },
    });

    // Step 2: refund. Idempotent — skip if we already have a refund id.
    await this.refundOrderIfNeeded(orderId);

    // Best-effort buyer push (self-wrapped; never breaks cancel/refund).
    await this.notifications.notifyOrderStatus(orderId, 'order_cancelled');

    return this.findOrderWithRelations(orderId);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async listOrders(
    where: Prisma.OrderWhereInput,
    status: OrderStatus | undefined,
    limit: number,
    offset: number,
  ): Promise<{ items: OrderWithEverything[]; hasMore: boolean }> {
    const rows = await this.prisma.db.order.findMany({
      where: { ...where, ...(status ? { status } : {}) },
      include: {
        items: { include: { addOns: true } },
        dropoffAddress: true,
      },
      orderBy: { placedAt: 'desc' },
      take: limit + 1,
      skip: offset,
    });
    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  private async loadAndValidateCart(items: CreateOrderItemDto[]): Promise<{
    listings: Array<{
      id: string;
      sellerId: string;
      name: string;
      priceCents: number;
      // null = "cook to order" (restaurant/traiteur — no inventory tracking).
      portionsLeft: number | null;
      isAvailable: boolean;
      // null = permanent menu item (restaurant/traiteur — never expires).
      expiresAt: Date | null;
      fulfillment: string;
      deletedAt: Date | null;
    }>;
    addOns: Map<string, { id: string; listingId: string; label: string; priceDeltaCents: number }>;
    sellerId: string;
    seller: { userId: string; isPremium: boolean; deliveryFeeCents: number };
  }> {
    const listingIds = Array.from(new Set(items.map((i) => i.listingId)));
    const listings = await this.prisma.db.listing.findMany({
      where: { id: { in: listingIds } },
      select: {
        id: true,
        sellerId: true,
        name: true,
        priceCents: true,
        portionsLeft: true,
        isAvailable: true,
        expiresAt: true,
        fulfillment: true,
        deletedAt: true,
      },
    });

    if (listings.length !== listingIds.length) {
      throw new BadRequestException('One or more listings not found');
    }

    // Single-seller orders only (v1).
    const sellerIds = Array.from(new Set(listings.map((l) => l.sellerId)));
    if (sellerIds.length > 1) {
      throw new BadRequestException('All items must belong to the same seller');
    }
    const sellerId = sellerIds[0];

    const seller = await this.prisma.db.sellerProfile.findUnique({
      where: { userId: sellerId },
      include: { user: true },
    });
    if (!seller || !seller.user) {
      throw new BadRequestException('Seller not found');
    }
    if (seller.kycStatus !== KycStatus.Approved) {
      throw new BadRequestException('Seller is not approved to take orders');
    }
    if (seller.user.deletedAt) {
      throw new BadRequestException('Seller account is unavailable');
    }
    // Mandatory platform subscription — a seller without an active $4/mo
    // subscription cannot receive new orders.
    if (!isSubscriptionActive(seller.subscriptionStatus, seller.subscriptionCurrentPeriodEnd)) {
      throw new BadRequestException('Seller is not currently accepting orders');
    }
    // Phase A: seller profile fields are nullable until the wizard fills
    // them in. An order needs at minimum a delivery fee — if it's null, the
    // seller hasn't finished signup and can't take orders yet.
    if (seller.deliveryFeeCents === null) {
      throw new BadRequestException('Seller delivery fee is missing');
    }

    // Per-listing live checks.
    const now = Date.now();
    for (const l of listings) {
      if (l.deletedAt) {
        throw new BadRequestException(`${l.name} is unavailable`);
      }
      if (!l.isAvailable) {
        throw new BadRequestException(`${l.name} is not available`);
      }
      // null expiresAt = permanent menu item (restaurant/traiteur).
      if (l.expiresAt !== null && l.expiresAt.getTime() <= now) {
        throw new BadRequestException(`${l.name} is no longer available`);
      }
    }

    // Resolve add-ons. Build a flat map keyed by addOn id.
    const allAddOnIds = Array.from(new Set(items.flatMap((i) => i.addOnIds ?? [])));
    const addOnRows = allAddOnIds.length
      ? await this.prisma.db.listingAddOn.findMany({
          where: { id: { in: allAddOnIds } },
          select: { id: true, listingId: true, label: true, priceDeltaCents: true },
        })
      : [];
    const addOns = new Map(addOnRows.map((a) => [a.id, a]));

    // Validate every requested addOn exists AND belongs to the right listing.
    for (const item of items) {
      for (const addOnId of item.addOnIds ?? []) {
        const addOn = addOns.get(addOnId);
        if (!addOn) {
          throw new BadRequestException(`Unknown add-on: ${addOnId}`);
        }
        if (addOn.listingId !== item.listingId) {
          throw new BadRequestException(
            `Add-on ${addOnId} does not belong to listing ${item.listingId}`,
          );
        }
      }
    }

    return {
      listings,
      addOns,
      sellerId,
      seller: {
        userId: seller.userId,
        isPremium: seller.isPremium,
        deliveryFeeCents: seller.deliveryFeeCents,
      },
    };
  }

  private async resolveDropoffAddress(buyerId: string, dto: CreateOrderDto): Promise<string> {
    const hasId = !!dto.dropoffAddressId;
    const hasInline = !!dto.dropoffAddress;

    if (hasId === hasInline) {
      throw new BadRequestException('Provide exactly one of dropoffAddressId or dropoffAddress');
    }

    if (hasId) {
      const existing = await this.prisma.db.address.findUnique({
        where: { id: dto.dropoffAddressId! },
        select: { id: true, userId: true, deletedAt: true },
      });
      if (!existing || existing.deletedAt) {
        throw new NotFoundException('Drop-off address not found');
      }
      if (existing.userId !== buyerId) {
        throw new ForbiddenException('Drop-off address does not belong to you');
      }
      return existing.id;
    }

    return this.createInlineAddress(buyerId, dto.dropoffAddress!);
  }

  private async createInlineAddress(buyerId: string, addr: CreateAddressDto): Promise<string> {
    const id = generateUlid();
    await this.prisma.$transaction(async (tx) => {
      await tx.address.create({
        data: {
          id,
          userId: buyerId,
          // An inline drop-off address is always a buyer-side delivery row.
          kind: AddressKind.BUYER_DELIVERY,
          type: addr.type ?? null,
          customLabel: addr.customLabel ?? null,
          fullAddress: addr.fullAddress,
          city: addr.city,
          postalCode: addr.postalCode,
          apartment: addr.apartment ?? null,
          floor: addr.floor ?? null,
          digicode: addr.digicode ?? null,
          deliveryNotes: addr.deliveryNotes ?? null,
        },
      });
      if (addr.lat !== undefined && addr.lng !== undefined) {
        await tx.$executeRaw`
          UPDATE "Address"
          SET "point" = ST_SetSRID(ST_MakePoint(${addr.lng}, ${addr.lat}), 4326)
          WHERE "id" = ${id}
        `;
      }
    });
    return id;
  }

  private computeTotals(
    items: CreateOrderItemDto[],
    listings: Array<{ id: string; priceCents: number }>,
    addOns: Map<string, { priceDeltaCents: number }>,
    seller: { isPremium: boolean; deliveryFeeCents: number },
    choice: FulfillmentChoice,
  ): {
    subtotalCents: number;
    fulfillmentFeeCents: number;
    commissionRateBps: number;
    commissionCents: number;
    sellerEarningsCents: number;
    buyerTotalCents: number;
  } {
    const listingPriceById = new Map(listings.map((l) => [l.id, l.priceCents]));

    let subtotalCents = 0;
    for (const item of items) {
      const price = listingPriceById.get(item.listingId)!;
      const addonsCents = (item.addOnIds ?? []).reduce(
        (sum, id) => sum + addOns.get(id)!.priceDeltaCents,
        0,
      );
      subtotalCents += (price + addonsCents) * item.quantity;
    }

    const fulfillmentFeeCents = choice === FulfillmentChoice.Delivery ? seller.deliveryFeeCents : 0;

    const commissionRateBps = seller.isPremium
      ? COMMISSION_RATE_BPS_PREMIUM
      : COMMISSION_RATE_BPS_STANDARD;
    // Commission = rate × subtotal, rounded, with a 1 € (100 cents) MINIMUM
    // per the client spec: commission = max(round(subtotal·rate), 100).
    const commissionCents = Math.max(
      Math.round((subtotalCents * commissionRateBps) / 10_000),
      COMMISSION_MIN_CENTS,
    );
    const sellerEarningsCents = subtotalCents - commissionCents;
    const buyerTotalCents = subtotalCents + fulfillmentFeeCents;

    // Sanity: the platform's eventual cut at transfer time is
    // commissionCents + fulfillmentFeeCents. That sum + sellerEarningsCents
    // must equal buyerTotalCents.
    if (commissionCents + sellerEarningsCents + fulfillmentFeeCents !== buyerTotalCents) {
      throw new Error('Money math mismatch in order totals computation');
    }

    return {
      subtotalCents,
      fulfillmentFeeCents,
      commissionRateBps,
      commissionCents,
      sellerEarningsCents,
      buyerTotalCents,
    };
  }

  private async ensureStripeCustomer(
    userId: string,
    email: string,
    existing: string | null,
  ): Promise<string> {
    // A stored customer id may be a dev placeholder (`cus_dev_…`) or belong
    // to a *different* Stripe account (after switching keys). Reuse it only
    // if it really exists in the current account; otherwise fall through and
    // create a fresh one (and overwrite the stale id below). This self-heals
    // the "No such customer" failure that was forcing the dev bypass.
    if (existing && !existing.startsWith('cus_dev_')) {
      try {
        const found = await this.stripe.client.customers.retrieve(existing);
        if (!(found as { deleted?: boolean }).deleted) {
          return existing;
        }
      } catch {
        // Not found in this account — recreate below.
      }
    }
    let customer: { id: string };
    try {
      customer = await this.stripe.client.customers.create({
        email,
        metadata: { userId },
      });
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        // Dev fallback: real Stripe creds aren't configured. Fabricate a
        // local-only customer id so the order can still be created.
        // Production path is untouched.
        this.logger.warn(
          `[dev] Stripe Customer creation failed (${(err as Error).message}); using local placeholder id`,
        );
        customer = { id: `cus_dev_${userId.slice(0, 16)}` };
      } else {
        this.logger.error(
          `Stripe Customer creation failed for user ${userId}: ${(err as Error).message}`,
        );
        throw new ServiceUnavailableException('Payment provider unavailable');
      }
    }
    try {
      await this.prisma.db.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
      });
    } catch (err) {
      // P2002 (unique violation): a concurrent request created one. Fetch and use that.
      if ((err as { code?: string }).code === 'P2002') {
        const refreshed = await this.prisma.db.user.findUnique({
          where: { id: userId },
          select: { stripeCustomerId: true },
        });
        if (refreshed?.stripeCustomerId) {
          return refreshed.stripeCustomerId;
        }
      }
      throw err;
    }
    return customer.id;
  }

  private async atomicDecrementInventory(
    tx: Tx,
    items: CreateOrderItemDto[],
    listings: Array<{ id: string; name: string }>,
  ): Promise<void> {
    const nameById = new Map(listings.map((l) => [l.id, l.name]));

    // Aggregate quantities by listing in case the same listing appears twice
    // in the cart.
    const wantedByListing = new Map<string, number>();
    for (const item of items) {
      wantedByListing.set(
        item.listingId,
        (wantedByListing.get(item.listingId) ?? 0) + item.quantity,
      );
    }

    for (const [listingId, quantity] of wantedByListing) {
      let updated = await tx.$executeRaw`
        UPDATE "Listing"
        SET "portionsLeft" = "portionsLeft" - ${quantity}
        WHERE "id" = ${listingId} AND "portionsLeft" >= ${quantity}
      `;
      if (updated === 0 && process.env.NODE_ENV === 'development') {
        // Dev fallback: keep the demo unblocked when test orders deplete
        // the listing. Top up to a high stock and retry once. Production
        // still hard-fails on stock-out.
        await tx.$executeRaw`
          UPDATE "Listing"
          SET "portionsLeft" = 99
          WHERE "id" = ${listingId}
        `;
        updated = await tx.$executeRaw`
          UPDATE "Listing"
          SET "portionsLeft" = "portionsLeft" - ${quantity}
          WHERE "id" = ${listingId} AND "portionsLeft" >= ${quantity}
        `;
        if (updated > 0) {
          this.logger.debug(
            `[dev] auto-refilled listing ${listingId} so order ${quantity}× could proceed`,
          );
        }
      }
      if (updated === 0) {
        // Roll the transaction by throwing — the inventory stays untouched
        // because failed UPDATEs above won't have committed.
        throw new ConflictException(
          `${nameById.get(listingId) ?? 'Listing'} is no longer available in the requested quantity`,
        );
      }
    }
  }

  private async insertOrder(
    tx: Tx,
    args: {
      orderId: string;
      orderNumber: string;
      buyerId: string;
      sellerId: string;
      dropoffAddressId: string | null;
      dto: CreateOrderDto;
      totals: {
        subtotalCents: number;
        fulfillmentFeeCents: number;
        commissionRateBps: number;
        commissionCents: number;
        sellerEarningsCents: number;
        buyerTotalCents: number;
      };
      listings: Array<{ id: string; name: string; priceCents: number }>;
      addOns: Map<string, { id: string; label: string; priceDeltaCents: number }>;
    },
  ): Promise<void> {
    // Snapshot the listings' current image — first of `imageUrls`, if any.
    const listingsWithImages = await tx.listing.findMany({
      where: { id: { in: args.listings.map((l) => l.id) } },
      select: { id: true, imageUrls: true },
    });
    const firstImageById = new Map(listingsWithImages.map((l) => [l.id, l.imageUrls[0] ?? null]));
    const nameById = new Map(args.listings.map((l) => [l.id, l.name]));
    const priceById = new Map(args.listings.map((l) => [l.id, l.priceCents]));

    await tx.order.create({
      data: {
        id: args.orderId,
        orderNumber: args.orderNumber,
        buyerId: args.buyerId,
        sellerId: args.sellerId,
        status: OrderStatus.Pending,
        subtotalCents: args.totals.subtotalCents,
        fulfillmentFeeCents: args.totals.fulfillmentFeeCents,
        commissionRateBps: args.totals.commissionRateBps,
        commissionCents: args.totals.commissionCents,
        sellerEarningsCents: args.totals.sellerEarningsCents,
        buyerTotalCents: args.totals.buyerTotalCents,
        fulfillmentChoice: args.dto.fulfillmentChoice,
        dropoffAddressId: args.dropoffAddressId,
        deliveryInstructions: args.dto.deliveryInstructions ?? null,
        deliveryTiming: args.dto.deliveryTiming ?? DeliveryTiming.Asap,
        scheduledAt: args.dto.scheduledAt ? new Date(args.dto.scheduledAt) : null,
        // expectedAt is set later by the scheduling/dispatch slice.
        expectedAt: null,
        note: args.dto.note ?? null,
      },
    });

    for (const item of args.dto.items) {
      const itemId = generateUlid();
      await tx.orderItem.create({
        data: {
          id: itemId,
          orderId: args.orderId,
          listingId: item.listingId,
          listingNameSnapshot: nameById.get(item.listingId)!,
          listingImageUrlSnapshot: firstImageById.get(item.listingId) ?? null,
          unitPriceCentsSnapshot: priceById.get(item.listingId)!,
          quantity: item.quantity,
          note: item.note ?? null,
        },
      });

      if (item.addOnIds && item.addOnIds.length > 0) {
        await tx.orderItemAddOn.createMany({
          data: item.addOnIds.map((addOnId) => {
            const addOn = args.addOns.get(addOnId)!;
            return {
              id: generateUlid(),
              orderItemId: itemId,
              labelSnapshot: addOn.label,
              priceDeltaCentsSnapshot: addOn.priceDeltaCents,
            };
          }),
        });
      }
    }
  }

  private async loadOrder(tx: Tx, orderId: string): Promise<OrderWithEverything> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { addOns: true } },
        dropoffAddress: true,
      },
    });
    // Just inserted in the same transaction.
    return order!;
  }

  // -----------------------------------------------------------------------
  // Lifecycle internals (Slice B)
  // -----------------------------------------------------------------------

  /**
   * Generic seller-side transition. Validates ownership, the source
   * status, and writes the new status + optional timestamps.
   */
  private async transitionAsSeller(
    supabaseId: string,
    orderId: string,
    spec: {
      from: OrderStatus[];
      to: OrderStatus;
      timestamps?: Partial<Record<'readyAt' | 'completedAt', Date>>;
    },
  ): Promise<OrderWithEverything> {
    const sellerId = await this.assertSellerUser(supabaseId);
    const existing = await this.loadOrderForSellerAction(orderId, sellerId);

    if (!spec.from.includes(existing.status as OrderStatus)) {
      throw new ConflictException(
        `Order is in ${existing.status}; transition to ${spec.to} requires one of [${spec.from.join(', ')}]`,
      );
    }

    await this.prisma.db.order.update({
      where: { id: orderId },
      data: {
        status: spec.to,
        ...(spec.timestamps ?? {}),
      },
    });
    await this.publishOrderStatusChanged(orderId, spec.to);
    return this.findOrderWithRelations(orderId);
  }

  /** Resolves the JWT to a User.id; doesn't enforce role here. */
  private async assertSellerUser(supabaseId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    return user.id;
  }

  /**
   * Loads the order and verifies the caller is its seller. 404 vs 403
   * distinction kept small to avoid leaking information about whose
   * orders exist.
   */
  private async loadOrderForSellerAction(
    orderId: string,
    sellerId: string,
  ): Promise<{
    id: string;
    status: string;
    sellerId: string;
    fulfillmentChoice: string;
    stripePaymentIntentId: string | null;
    stripeRefundId: string | null;
  }> {
    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        sellerId: true,
        fulfillmentChoice: true,
        stripePaymentIntentId: true,
        stripeRefundId: true,
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.sellerId !== sellerId) {
      throw new ForbiddenException("Cannot act on another seller's order");
    }
    return order;
  }

  private async findOrderWithRelations(orderId: string): Promise<OrderWithEverything> {
    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { addOns: true } },
        dropoffAddress: true,
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * Issues a full refund for the order via Stripe and persists the
   * refund id. Idempotent: skips if a refund is already recorded.
   *
   * Failure mode: if Stripe rejects (rare — usually only when the
   * underlying charge has been disputed), the order stays CANCELLED but
   * with no stripeRefundId. Admin tooling backfills.
   */
  private async refundOrderIfNeeded(orderId: string): Promise<void> {
    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: { stripePaymentIntentId: true, stripeRefundId: true, buyerTotalCents: true },
    });
    if (!order) {
      return; // shouldn't happen — caller just wrote the row
    }
    if (order.stripeRefundId) {
      return; // already refunded (idempotent retry)
    }
    if (!order.stripePaymentIntentId) {
      // Order was cancelled while still in PENDING and never had a PI.
      // Nothing to refund.
      this.logger.warn(`Order ${orderId} cancelled with no PaymentIntent — skipping refund`);
      return;
    }

    let refund: Stripe.Refund;
    try {
      refund = await this.stripe.client.refunds.create({
        payment_intent: order.stripePaymentIntentId,
        // No `amount` → full refund of the remaining capturable amount.
        metadata: { orderId },
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(
        `Refund creation failed for order ${orderId}: ${message}. Order stays CANCELLED; manual reconciliation required.`,
      );
      await this.audit.record({
        actorId: null,
        action: 'order.refund.failed',
        targetType: 'Order',
        targetId: orderId,
        metadata: {
          paymentIntentId: order.stripePaymentIntentId,
          amountCents: order.buyerTotalCents,
          error: message,
        },
      });
      return;
    }

    try {
      await this.prisma.db.order.update({
        where: { id: orderId },
        data: {
          stripeRefundId: refund.id,
          refundedAt: new Date(),
        },
      });
    } catch (err) {
      // Refund created but our update failed — log loudly, the refund
      // already happened in Stripe so the buyer is whole.
      this.logger.error(
        `Refund ${refund.id} for order ${orderId} succeeded in Stripe but DB update failed: ${(err as Error).message}`,
      );
    }

    await this.audit.record({
      actorId: null,
      action: 'order.refund',
      targetType: 'Order',
      targetId: orderId,
      metadata: {
        refundId: refund.id,
        paymentIntentId: order.stripePaymentIntentId,
        amountCents: order.buyerTotalCents,
      },
    });
  }
}
