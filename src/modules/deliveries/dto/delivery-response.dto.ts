import type { Delivery, Order } from '@prisma/client';
import { DeliveryStatus, OrderStatus } from '@prisma/client';

/**
 * What the driver sees. Slim — driver app doesn't need OrderItem detail
 * up front; that comes via a separate `GET /v1/orders/:id` call when the
 * driver taps in for full info.
 *
 * For "available" deliveries (SEARCHING), the driver gets enough to
 * decide whether to claim: orderNumber, fulfillmentFee (their pay),
 * dropoff city/postcode, and the seller's neighborhood.
 */
export class DeliveryResponseDto {
  id!: string;
  status!: DeliveryStatus;
  orderId!: string;
  orderNumber!: string;
  orderStatus!: OrderStatus;

  driverId!: string | null;

  /** What the driver gets paid (entire fulfillment fee, no platform cut). */
  driverPayoutCents!: number;

  pickupNeighborhood!: string | null;
  dropoffCity!: string;
  dropoffPostalCode!: string;

  driverAssignedAt!: Date | null;
  pickedUpAt!: Date | null;
  deliveredAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;

  static from(
    row: Delivery & {
      order: Pick<
        Order,
        'orderNumber' | 'status' | 'fulfillmentFeeCents'
      > & {
        seller: { neighborhood: string | null };
        dropoffAddress: { city: string; postalCode: string };
      };
    },
  ): DeliveryResponseDto {
    return {
      id: row.id,
      status: row.status,
      orderId: row.orderId,
      orderNumber: row.order.orderNumber,
      orderStatus: row.order.status,
      driverId: row.driverId,
      driverPayoutCents: row.order.fulfillmentFeeCents,
      pickupNeighborhood: row.order.seller.neighborhood,
      dropoffCity: row.order.dropoffAddress.city,
      dropoffPostalCode: row.order.dropoffAddress.postalCode,
      driverAssignedAt: row.driverAssignedAt,
      pickedUpAt: row.pickedUpAt,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export class DeliveryListResponseDto {
  items!: DeliveryResponseDto[];
  limit!: number;
  offset!: number;
  hasMore!: boolean;
}
