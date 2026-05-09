export enum DeliveryStatus {
  Unassigned = 'UNASSIGNED',
  Searching = 'SEARCHING',
  Assigned = 'ASSIGNED',
  EnRouteToPickup = 'EN_ROUTE_TO_PICKUP',
  AtPickup = 'AT_PICKUP',
  PickedUp = 'PICKED_UP',
  EnRouteToDropoff = 'EN_ROUTE_TO_DROPOFF',
  AtDropoff = 'AT_DROPOFF',
  Delivered = 'DELIVERED',
  Cancelled = 'CANCELLED',
  Failed = 'FAILED',
}
