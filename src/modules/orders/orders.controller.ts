import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { IdempotencyKey } from '@common/decorators/idempotency-key.decorator';
import { IdempotencyService } from '@common/services/idempotency.service';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { AddressResponseDto } from '@modules/users/dto/address-response.dto';

import { CancelOrderDto } from './dto/cancel-order.dto';
import { CannotProvideDto } from './dto/cannot-provide.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { DeliveryProofResponseDto } from './dto/delivery-proof-response.dto';
import { DeliveryQrResponseDto } from './dto/delivery-qr-response.dto';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';
import { NoDriverDecisionDto } from './dto/no-driver-decision.dto';
import {
  CreateOrderResponseDto,
  OrderListResponseDto,
  OrderResponseDto,
} from './dto/order-response.dto';
import { PickupQrResponseDto } from './dto/pickup-qr-response.dto';
import { OrderTrackingResponseDto } from './dto/tracking-response.dto';
import { OrdersService } from './orders.service';

/**
 * No class-level path: methods carry full paths so we can serve
 * `/orders/...`, `/orders/me`, and `/sellers/me/orders` from one class
 * without `me` colliding with `:id`. (NestJS matches routes in declaration
 * order, but separating namespaces cleanly is clearer than relying on it.)
 */
@Controller({ version: '1' })
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Creates a PENDING order + Stripe PaymentIntent. The Flutter app uses
   * the returned `paymentIntentClientSecret` with the Stripe SDK Payment
   * Sheet to collect payment.
   *
   * Requires `Idempotency-Key` header. Replays the original response on a
   * duplicate call with same key + body. 409 if the same key is reused
   * with a different body.
   */
  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @IdempotencyKey() idempotencyKey: string | undefined,
    @Body() dto: CreateOrderDto,
  ): Promise<CreateOrderResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const cached = await this.idempotency.get(jwtUser.id, idempotencyKey, dto);
    if (cached) {
      return cached.response as CreateOrderResponseDto;
    }

    const { order, paymentIntentClientSecret } = await this.orders.createOrder(jwtUser.id, dto);
    const response: CreateOrderResponseDto = {
      order: OrderResponseDto.from(
        order,
        order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
      ),
      paymentIntentClientSecret,
    };

    await this.idempotency.save(jwtUser.id, idempotencyKey, dto, HttpStatus.CREATED, response);

    return response;
  }

  /** Buyer's order history, newest first. */
  @Get('orders/me')
  async listMine(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderListResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const result = await this.orders.listForBuyer(jwtUser.id, query.status, limit, offset);
    return {
      items: result.items.map((o) =>
        OrderResponseDto.from(
          o,
          o.dropoffAddress ? AddressResponseDto.from(o.dropoffAddress, null) : null,
        ),
      ),
      limit,
      offset,
      hasMore: result.hasMore,
    };
  }

  /** Seller's incoming orders, newest first. */
  @Get('sellers/me/orders')
  async listForSeller(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrderListResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const result = await this.orders.listForSeller(jwtUser.id, query.status, limit, offset);
    return {
      items: result.items.map((o) =>
        OrderResponseDto.from(
          o,
          o.dropoffAddress ? AddressResponseDto.from(o.dropoffAddress, null) : null,
        ),
      ),
      limit,
      offset,
      hasMore: result.hasMore,
    };
  }

  /**
   * Seller pickup-proof QR for a DELIVERY order. Only the order's seller can
   * fetch it; the order must be READY. The assigned driver scans the returned
   * payload to confirm pickup.
   */
  @Get('sellers/me/orders/:orderId/pickup-qr')
  sellerPickupQr(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('orderId') orderId: string,
  ): Promise<PickupQrResponseDto> {
    return this.orders.getSellerPickupQr(jwtUser.id, orderId);
  }

  /**
   * Buyer-only: the reception-proof QR for one of the buyer's orders. Only the
   * order's buyer may fetch it; the order must be IN_DELIVERY with pickup
   * already confirmed. The assigned driver scans the returned payload to
   * confirm delivery.
   */
  @Get('orders/:orderId/delivery-qr')
  buyerDeliveryQr(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('orderId') orderId: string,
  ): Promise<DeliveryQrResponseDto> {
    return this.orders.getBuyerDeliveryQr(jwtUser.id, orderId);
  }

  /**
   * Delivery completion proof for the order's buyer or seller (only). Surfaces
   * the client-absent photo + GPS + timestamp when the order was left at the
   * door; absent-proof fields are null for a normal QR delivery.
   */
  @Get('orders/:orderId/delivery-proof')
  deliveryProof(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('orderId') orderId: string,
  ): Promise<DeliveryProofResponseDto> {
    return this.orders.getOrderDeliveryProof(jwtUser.id, orderId);
  }

  /**
   * Order details. Visible to the buyer (own) or the seller (own).
   * Declared after `/orders/me` so the `me` segment matches that route
   * first; relying on declaration order, but separating namespaces makes
   * it robust either way.
   */
  @Get('orders/:id')
  async findById(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.findById(jwtUser.id, id);
    return OrderResponseDto.from(
      order,
      order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
    );
  }

  /**
   * Live-tracking snapshot for the order's map — real pickup/dropoff/driver
   * coordinates + statuses. Readable by the buyer, seller, or assigned
   * driver. Live driver movement after this then streams over the
   * `/tracking` socket; this just gives the initial frame + correct leg.
   */
  @Get('orders/:id/tracking')
  async tracking(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OrderTrackingResponseDto> {
    return this.orders.getTracking(jwtUser.id, id);
  }

  /**
   * Buyer confirms their payment succeeded. The server re-verifies the
   * PaymentIntent with Stripe and, only if it really succeeded, advances
   * the order PENDING → CONFIRMED (so it reaches the seller). Idempotent.
   */
  @Post('orders/:id/confirm-payment')
  @HttpCode(HttpStatus.OK)
  async confirmPayment(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.confirmPaymentForBuyer(jwtUser.id, id);
    return OrderResponseDto.from(
      order,
      order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
    );
  }

  // -------------------------------------------------------------------
  // Slice B — seller-side lifecycle transitions
  // -------------------------------------------------------------------

  /** CONFIRMED → PREPARING. Seller has accepted and started cooking. */
  @Post('orders/:id/start-preparing')
  @HttpCode(HttpStatus.OK)
  async startPreparing(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.startPreparing(jwtUser.id, id);
    return OrderResponseDto.from(
      order,
      order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
    );
  }

  /** PREPARING → READY. Food is ready for pickup or driver dispatch. */
  @Post('orders/:id/mark-ready')
  @HttpCode(HttpStatus.OK)
  async markReady(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.markReady(jwtUser.id, id);
    return OrderResponseDto.from(
      order,
      order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
    );
  }

  /**
   * READY → DELIVERED. PICKUP orders only — buyer has arrived and taken
   * the food. DELIVERY orders use the driver flow (Slice C).
   */
  @Post('orders/:id/confirm-pickup')
  @HttpCode(HttpStatus.OK)
  async confirmPickup(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.confirmPickup(jwtUser.id, id);
    return OrderResponseDto.from(
      order,
      order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
    );
  }

  /**
   * Cancel from CONFIRMED, PREPARING, or READY. Atomic: status →
   * CANCELLED, restores inventory, issues full Stripe refund. Returns
   * the cancelled order.
   */
  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.cancelAsSeller(jwtUser.id, id, dto.reason);
    return OrderResponseDto.from(
      order,
      order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
    );
  }

  /**
   * Buyer's decision when no driver accepted the delivery (order is
   * NO_DRIVER_AVAILABLE): switch to pickup, or cancel + refund. Buyer-only.
   */
  @Post('orders/:orderId/no-driver-decision')
  @HttpCode(HttpStatus.OK)
  async noDriverDecision(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: NoDriverDecisionDto,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.decideNoDriver(jwtUser.id, orderId, dto.decision);
    return OrderResponseDto.from(
      order,
      order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
    );
  }

  /**
   * Seller proactively cancels an order they can't fulfil ("Je ne peux pas
   * fournir"), before pickup. Refunds the buyer, cancels any delivery, and adds
   * a light seller strike. Seller-only.
   */
  @Post('sellers/me/orders/:orderId/cannot-provide')
  @HttpCode(HttpStatus.OK)
  async cannotProvide(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: CannotProvideDto,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.sellerCannotProvide(jwtUser.id, orderId, dto);
    return OrderResponseDto.from(
      order,
      order.dropoffAddress ? AddressResponseDto.from(order.dropoffAddress, null) : null,
    );
  }

  /**
   * Buyer files a post-delivery claim (never received, wrong order, spoiled
   * food, food poisoning, or subjective dissatisfaction). Auto-refunds the
   * allowed cases; routes sensitive ones to admin review. Buyer-only.
   */
  @Post('orders/:orderId/disputes')
  @HttpCode(HttpStatus.CREATED)
  async createDispute(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: CreateDisputeDto,
  ): Promise<{ dispute: unknown; message: string }> {
    return this.orders.createDispute(jwtUser.id, orderId, dto);
  }
}
