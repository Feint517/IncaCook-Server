import { DeliveryTiming } from '@common/enums/delivery-timing.enum';
import { FulfillmentChoice } from '@common/enums/fulfillment-choice.enum';
import { OrderStatus } from '@common/enums/order-status.enum';

import { AddressResponseDto } from '@modules/users/dto/address-response.dto';

import type { Order, OrderItem, OrderItemAddOn } from '@prisma/client';

export class OrderItemAddOnResponseDto {
  id!: string;
  label!: string;
  priceDeltaCents!: number;

  static from(addOn: OrderItemAddOn): OrderItemAddOnResponseDto {
    return {
      id: addOn.id,
      label: addOn.labelSnapshot,
      priceDeltaCents: addOn.priceDeltaCentsSnapshot,
    };
  }
}

export class OrderItemResponseDto {
  id!: string;
  listingId!: string;
  listingName!: string;
  listingImageUrl!: string | null;
  unitPriceCents!: number;
  quantity!: number;
  /** Derived: unitPriceCents * quantity + Σ addons * quantity. */
  lineTotalCents!: number;
  note!: string | null;
  addOns!: OrderItemAddOnResponseDto[];

  static from(item: OrderItem & { addOns: OrderItemAddOn[] }): OrderItemResponseDto {
    const addOnsTotal = item.addOns.reduce((sum, a) => sum + a.priceDeltaCentsSnapshot, 0);
    const lineTotal = (item.unitPriceCentsSnapshot + addOnsTotal) * item.quantity;
    return {
      id: item.id,
      listingId: item.listingId,
      listingName: item.listingNameSnapshot,
      listingImageUrl: item.listingImageUrlSnapshot,
      unitPriceCents: item.unitPriceCentsSnapshot,
      quantity: item.quantity,
      lineTotalCents: lineTotal,
      note: item.note,
      addOns: item.addOns.map((a) => OrderItemAddOnResponseDto.from(a)),
    };
  }
}

export class OrderResponseDto {
  id!: string;
  orderNumber!: string;
  status!: OrderStatus;
  buyerId!: string;
  sellerId!: string;

  // Pricing snapshot.
  subtotalCents!: number;
  fulfillmentFeeCents!: number;
  commissionCents!: number;
  sellerEarningsCents!: number;
  buyerTotalCents!: number;
  commissionRateBps!: number;

  fulfillmentChoice!: FulfillmentChoice;
  /** Null for PICKUP orders (no delivery address). */
  dropoffAddress!: AddressResponseDto | null;
  deliveryInstructions!: string | null;

  deliveryTiming!: DeliveryTiming;
  scheduledAt!: Date | null;
  expectedAt!: Date | null;

  note!: string | null;

  // Lifecycle.
  placedAt!: Date;
  confirmedAt!: Date | null;
  readyAt!: Date | null;
  completedAt!: Date | null;
  cancelledAt!: Date | null;
  cancellationReason!: string | null;

  items!: OrderItemResponseDto[];

  static from(
    order: Order & {
      items: Array<OrderItem & { addOns: OrderItemAddOn[] }>;
    },
    dropoffAddress: AddressResponseDto | null,
  ): OrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status as OrderStatus,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      subtotalCents: order.subtotalCents,
      fulfillmentFeeCents: order.fulfillmentFeeCents,
      commissionCents: order.commissionCents,
      sellerEarningsCents: order.sellerEarningsCents,
      buyerTotalCents: order.buyerTotalCents,
      commissionRateBps: order.commissionRateBps,
      fulfillmentChoice: order.fulfillmentChoice as FulfillmentChoice,
      dropoffAddress,
      deliveryInstructions: order.deliveryInstructions,
      deliveryTiming: order.deliveryTiming as DeliveryTiming,
      scheduledAt: order.scheduledAt,
      expectedAt: order.expectedAt,
      note: order.note,
      placedAt: order.placedAt,
      confirmedAt: order.confirmedAt,
      readyAt: order.readyAt,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
      cancellationReason: order.cancellationReason,
      items: order.items.map((i) => OrderItemResponseDto.from(i)),
    };
  }
}

export class CreateOrderResponseDto {
  order!: OrderResponseDto;
  /** Stripe PaymentIntent client_secret. The Flutter app uses this with
   *  the Stripe SDK Payment Sheet to collect payment from the buyer. */
  paymentIntentClientSecret!: string;
}

export class OrderListResponseDto {
  items!: OrderResponseDto[];
  limit!: number;
  offset!: number;
  hasMore!: boolean;
}
