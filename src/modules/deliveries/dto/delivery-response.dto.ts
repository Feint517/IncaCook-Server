import { DeliveryStatus, OrderStatus } from '@prisma/client';

import type { Delivery, Order } from '@prisma/client';

/**
 * Optional enrichment overlay used by `listAvailable` so the driver
 * app's incoming-order modal can render real seller/dropoff names,
 * and the map can route to the real pickup point. PostGIS coords are
 * fetched via raw SQL (Prisma can't `select` `Unsupported(geography)`).
 */
export interface DeliveryEnrichment {
  pickupLat: number | null;
  pickupLng: number | null;
  pickupFullAddress: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  dropoffFullAddress: string;
  sellerName: string | null;
  /** Buyer's display name — who the driver hands the food to at dropoff. */
  recipientName: string | null;
  orderTotalCents: number;
  placedAt: Date;
  itemCount: number;
}

/**
 * What the driver sees. The first 14 fields are always present; the
 * trailing enrichment block (sellerName, pickup/dropoff lat-lng,
 * full address, total, item count) is only populated by
 * `listAvailable` — other delivery endpoints leave those null.
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

  // Enrichment (null on endpoints that don't populate them).
  pickupLat!: number | null;
  pickupLng!: number | null;
  pickupFullAddress!: string | null;
  dropoffLat!: number | null;
  dropoffLng!: number | null;
  dropoffFullAddress!: string | null;
  sellerName!: string | null;
  recipientName!: string | null;
  orderTotalCents!: number | null;
  placedAt!: Date | null;
  itemCount!: number | null;

  driverAssignedAt!: Date | null;
  pickedUpAt!: Date | null;
  deliveredAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;

  static from(
    row: Delivery & {
      order: Pick<Order, 'orderNumber' | 'status' | 'fulfillmentFeeCents'> & {
        seller: { neighborhood: string | null };
        dropoffAddress: { city: string; postalCode: string | null } | null;
      };
    },
    enrichment?: DeliveryEnrichment,
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
      dropoffCity: row.order.dropoffAddress?.city ?? '',
      dropoffPostalCode: row.order.dropoffAddress?.postalCode ?? '',
      pickupLat: enrichment?.pickupLat ?? null,
      pickupLng: enrichment?.pickupLng ?? null,
      pickupFullAddress: enrichment?.pickupFullAddress ?? null,
      dropoffLat: enrichment?.dropoffLat ?? null,
      dropoffLng: enrichment?.dropoffLng ?? null,
      dropoffFullAddress: enrichment?.dropoffFullAddress ?? null,
      sellerName: enrichment?.sellerName ?? null,
      recipientName: enrichment?.recipientName ?? null,
      orderTotalCents: enrichment?.orderTotalCents ?? null,
      placedAt: enrichment?.placedAt ?? null,
      itemCount: enrichment?.itemCount ?? null,
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
