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
import type { Address, Order, OrderItem, OrderItemAddOn } from '@prisma/client';
import type Stripe from 'stripe';

import { DeliveryTiming } from '@common/enums/delivery-timing.enum';
import { FulfillmentChoice } from '@common/enums/fulfillment-choice.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { OrderStatus } from '@common/enums/order-status.enum';
import { generateOrderCode, generateUlid } from '@common/utils/code-generator.util';

import { AuditService } from '@infrastructure/audit/audit.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StripeService } from '@infrastructure/stripe/stripe.service';

import { CreateAddressDto } from '@modules/users/dto/create-address.dto';

import { CreateOrderDto } from './dto/create-order.dto';
import { CreateOrderItemDto } from './dto/create-order-item.dto';

type OrderWithEverything = Order & {
  items: Array<OrderItem & { addOns: OrderItemAddOn[] }>;
  dropoffAddress: Address;
};

type Tx = Prisma.TransactionClient;

/** Premium sellers pay 25%, everyone else 30%. Mirrors the env defaults. */
const COMMISSION_RATE_BPS_STANDARD = 3000;
const COMMISSION_RATE_BPS_PREMIUM = 2500;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly audit: AuditService,
  ) {}

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

    // ---- 5. Resolve drop-off address ----
    const dropoffAddressId = await this.resolveDropoffAddress(buyer.id, dto);

    // ---- 6. Compute totals ----
    const totals = this.computeTotals(dto.items, listings, addOns, seller, dto.fulfillmentChoice);

    // ---- 7. Ensure Stripe Customer (before DB write so we don't strand orders) ----
    const stripeCustomerId = await this.ensureStripeCustomer(buyer.id, buyer.email, buyer.stripeCustomerId);

    // ---- 8. DB transaction: decrement inventory + insert order ----
    const orderId = generateUlid();
    const orderNumber = generateOrderCode();
    let createdOrder: OrderWithEverything;
    try {
      createdOrder = await this.prisma.$transaction(async (tx) => {
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
    } catch (err) {
      // The atomic-decrement helper throws ConflictException with a clear
      // listing name on stock-out. Other transaction errors bubble up as-is.
      throw err;
    }

    // ---- 9. Create PaymentIntent (separate-charges pattern) ----
    let pi: Stripe.PaymentIntent;
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
      this.logger.error(
        `Stripe PaymentIntent creation failed for order ${orderId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('Payment provider unavailable');
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
    return { order: createdOrder, paymentIntentClientSecret: pi.client_secret };
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
      throw new ForbiddenException('Cannot view another user\'s order');
    }
    return order;
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
    return this.transitionAsSeller(supabaseId, orderId, {
      from: [OrderStatus.Confirmed],
      to: OrderStatus.Preparing,
    });
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
      throw new ConflictException(
        `Order is in ${existing.status}; mark-ready requires PREPARING`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.Ready, readyAt: new Date() },
      });

      // Auto-spawn the delivery for DELIVERY orders. The atomic claim in
      // DeliveriesService.claim handles the race when multiple drivers
      // try to grab it.
      if (existing.fulfillmentChoice === FulfillmentChoice.Delivery) {
        await tx.delivery.create({
          data: {
            id: generateUlid(),
            orderId,
            // status defaults to UNASSIGNED in the enum's first slot;
            // we want SEARCHING ("actively looking for a driver") which
            // is the live-broadcast state.
            status: 'SEARCHING',
          },
        });
      }
    });

    return this.findOrderWithRelations(orderId);
  }

  /**
   * READY → DELIVERED for PICKUP orders only. Buyer has arrived and taken
   * the food; the seller confirms. For DELIVERY orders this is the
   * driver's responsibility (Slice C).
   */
  async confirmPickup(supabaseId: string, orderId: string): Promise<OrderWithEverything> {
    const sellerId = await this.assertSellerUser(supabaseId);
    const order = await this.loadOrderForSellerAction(orderId, sellerId);

    if (order.fulfillmentChoice !== FulfillmentChoice.Pickup) {
      throw new BadRequestException(
        'confirm-pickup is only valid for PICKUP orders; DELIVERY uses the driver flow',
      );
    }
    if (order.status !== OrderStatus.Ready) {
      throw new ConflictException(
        `Order is in ${order.status}; confirm-pickup requires READY`,
      );
    }

    await this.prisma.db.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.Delivered },
    });

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
    }

    await this.releaseFundsForCompletedOrder(orderId);
    return this.findOrderWithRelations(orderId);
  }

  /**
   * Releases held funds from the platform balance to seller (and driver,
   * for DELIVERY orders). Safe to call multiple times — short-circuits if
   * `stripeTransferId` is already set for the seller leg, and likewise
   * for the driver leg.
   *
   * Failure mode: if Stripe rejects, we log and leave the order without
   * a `stripeTransferId`. Admin tooling backfills via reconciliation
   * (TODO: dedicated retry job).
   */
  private async releaseFundsForCompletedOrder(orderId: string): Promise<void> {
    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        sellerId: true,
        sellerEarningsCents: true,
        fulfillmentFeeCents: true,
        fulfillmentChoice: true,
        stripePaymentIntentId: true,
        stripeTransferId: true,
        stripeDriverTransferId: true,
        deliveries: {
          where: { status: 'DELIVERED' },
          select: { driverId: true },
          orderBy: { deliveredAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!order || !order.stripePaymentIntentId) {
      this.logger.warn(`Cannot release funds for ${orderId}: no PaymentIntent`);
      return;
    }

    // Resolve the seller's Connect account.
    const seller = await this.prisma.db.sellerProfile.findUnique({
      where: { userId: order.sellerId },
      select: { stripeConnectAccountId: true },
    });
    if (!seller?.stripeConnectAccountId) {
      this.logger.error(
        `Seller ${order.sellerId} has no Stripe Connect account — cannot release funds for order ${orderId}`,
      );
      return;
    }

    // Need the latest_charge id to source the transfer (Stripe ties the
    // transfer to the original charge for ledger / refund tracking).
    let latestChargeId: string | null = null;
    try {
      const pi = await this.stripe.client.paymentIntents.retrieve(order.stripePaymentIntentId);
      latestChargeId = (pi.latest_charge as string | null) ?? null;
    } catch (err) {
      this.logger.error(
        `Failed to retrieve PaymentIntent for order ${orderId}: ${(err as Error).message}`,
      );
      return;
    }
    if (!latestChargeId) {
      this.logger.error(`Order ${orderId}'s PaymentIntent has no latest_charge`);
      return;
    }

    // Seller transfer.
    if (!order.stripeTransferId && order.sellerEarningsCents > 0) {
      try {
        const transfer = await this.stripe.client.transfers.create({
          amount: order.sellerEarningsCents,
          currency: 'eur',
          destination: seller.stripeConnectAccountId,
          source_transaction: latestChargeId,
          metadata: { orderId, leg: 'seller' },
        });
        await this.prisma.db.order.update({
          where: { id: orderId },
          data: {
            stripeTransferId: transfer.id,
            transferredAt: new Date(),
          },
        });
        await this.audit.record({
          actorId: null,
          action: 'order.transfer_seller',
          targetType: 'Order',
          targetId: orderId,
          metadata: {
            transferId: transfer.id,
            amountCents: order.sellerEarningsCents,
            destination: seller.stripeConnectAccountId,
          },
        });
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error(`Seller transfer failed for order ${orderId}: ${message}`);
        await this.audit.record({
          actorId: null,
          action: 'order.transfer_seller.failed',
          targetType: 'Order',
          targetId: orderId,
          metadata: {
            amountCents: order.sellerEarningsCents,
            destination: seller.stripeConnectAccountId,
            error: message,
          },
        });
      }
    }

    // Driver transfer (DELIVERY only). Skip for PICKUP and when no driver
    // is associated with the delivery yet.
    if (
      order.fulfillmentChoice === FulfillmentChoice.Delivery &&
      !order.stripeDriverTransferId &&
      order.fulfillmentFeeCents > 0 &&
      order.deliveries[0]?.driverId
    ) {
      const driverId = order.deliveries[0].driverId;
      const driver = await this.prisma.db.driverProfile.findUnique({
        where: { userId: driverId },
        select: { stripeConnectAccountId: true },
      });
      if (driver?.stripeConnectAccountId) {
        try {
          const transfer = await this.stripe.client.transfers.create({
            amount: order.fulfillmentFeeCents,
            currency: 'eur',
            destination: driver.stripeConnectAccountId,
            source_transaction: latestChargeId,
            metadata: { orderId, leg: 'driver', driverId },
          });
          await this.prisma.db.order.update({
            where: { id: orderId },
            data: { stripeDriverTransferId: transfer.id },
          });
          await this.audit.record({
            actorId: null,
            action: 'order.transfer_driver',
            targetType: 'Order',
            targetId: orderId,
            metadata: {
              transferId: transfer.id,
              amountCents: order.fulfillmentFeeCents,
              destination: driver.stripeConnectAccountId,
              driverId,
            },
          });
        } catch (err) {
          const message = (err as Error).message;
          this.logger.error(`Driver transfer failed for order ${orderId}: ${message}`);
          await this.audit.record({
            actorId: null,
            action: 'order.transfer_driver.failed',
            targetType: 'Order',
            targetId: orderId,
            metadata: {
              amountCents: order.fulfillmentFeeCents,
              destination: driver.stripeConnectAccountId,
              driverId,
              error: message,
            },
          });
        }
      } else {
        this.logger.error(
          `Driver ${driverId} has no Stripe Connect account — skipping driver payout for order ${orderId}`,
        );
      }
    }
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

  private async loadAndValidateCart(
    items: CreateOrderItemDto[],
  ): Promise<{
    listings: Array<{
      id: string;
      sellerId: string;
      name: string;
      priceCents: number;
      portionsLeft: number;
      isAvailable: boolean;
      expiresAt: Date;
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
    // Phase A: seller profile fields are nullable until the wizard fills
    // them in. An order needs at minimum a delivery fee — if it's null, the
    // seller hasn't finished signup and can't take orders yet.
    if (seller.deliveryFeeCents === null) {
      throw new BadRequestException('Seller has not finished profile setup');
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
      if (l.expiresAt.getTime() <= now) {
        throw new BadRequestException(`${l.name} is no longer available`);
      }
    }

    // Resolve add-ons. Build a flat map keyed by addOn id.
    const allAddOnIds = Array.from(
      new Set(items.flatMap((i) => i.addOnIds ?? [])),
    );
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
      throw new BadRequestException(
        'Provide exactly one of dropoffAddressId or dropoffAddress',
      );
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

  private async createInlineAddress(
    buyerId: string,
    addr: CreateAddressDto,
  ): Promise<string> {
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

    const fulfillmentFeeCents =
      choice === FulfillmentChoice.Delivery ? seller.deliveryFeeCents : 0;

    const commissionRateBps = seller.isPremium
      ? COMMISSION_RATE_BPS_PREMIUM
      : COMMISSION_RATE_BPS_STANDARD;
    const commissionCents = Math.floor((subtotalCents * commissionRateBps) / 10_000);
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
    if (existing) {
      return existing;
    }
    let customer: Stripe.Customer;
    try {
      customer = await this.stripe.client.customers.create({
        email,
        metadata: { userId },
      });
    } catch (err) {
      this.logger.error(
        `Stripe Customer creation failed for user ${userId}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('Payment provider unavailable');
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
      const updated = await tx.$executeRaw`
        UPDATE "Listing"
        SET "portionsLeft" = "portionsLeft" - ${quantity}
        WHERE "id" = ${listingId} AND "portionsLeft" >= ${quantity}
      `;
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
      dropoffAddressId: string;
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
    const firstImageById = new Map(
      listingsWithImages.map((l) => [l.id, l.imageUrls[0] ?? null]),
    );
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
      throw new ForbiddenException('Cannot act on another seller\'s order');
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
