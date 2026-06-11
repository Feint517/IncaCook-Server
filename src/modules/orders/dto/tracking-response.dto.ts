export class GeoPointDto {
  lat!: number;
  lng!: number;
}

/**
 * Identity of the assigned delivery driver, surfaced to the buyer/seller
 * once a driver has claimed the delivery. Null until then — the buyer must
 * never see a driver before assignment.
 */
export class TrackingDriverDto {
  firstName!: string;
  lastName!: string;
  /** Storage path in `avatars/`; resolve to a URL client-side. Null if unset. */
  avatarPath!: string | null;
  phone!: string | null;
}

/**
 * Map-tracking snapshot for one order. Powers the buyer's live tracking
 * screen (and could back any viewer): the real pickup (seller) and
 * dropoff (client) coordinates, the assigned driver's last-known point,
 * and the statuses that decide which leg's route to draw.
 *
 *   - order status before IN_DELIVERY  → driver heading to the seller,
 *     route = driver → pickup.
 *   - order status IN_DELIVERY         → driver has the food, heading to
 *     the client, route = driver → dropoff.
 *   - DELIVERED                        → tracking stops, trip complete.
 *
 * This is the initial frame only; live driver movement afterwards streams
 * over the `/tracking` socket (`driver:location`).
 */
export class OrderTrackingResponseDto {
  /** Backend `OrderStatus` enum string (PENDING … DELIVERED …). */
  orderStatus!: string;
  /** `DELIVERY` | `PICKUP` — lets the client show the pickup handoff UI. */
  fulfillmentChoice!: string;
  /** Backend `DeliveryStatus` enum string, or null when no delivery row. */
  deliveryStatus!: string | null;
  deliveryId!: string | null;

  /** Seller pickup location. Null if the seller has no geocoded point. */
  pickup!: GeoPointDto | null;

  /** Client dropoff location. Null if the address has no geocoded point. */
  dropoff!: GeoPointDto | null;

  /** Assigned driver's last-known point. Null until a driver is assigned
   *  and has pushed at least one location fix. */
  driver!: GeoPointDto | null;

  /** Assigned driver's identity. Null until a driver claims the delivery —
   *  present as soon as assigned, even before the first location fix. */
  driverInfo!: TrackingDriverDto | null;
}
