export enum OrderStatus {
  Pending = 'PENDING',
  Confirmed = 'CONFIRMED',
  Preparing = 'PREPARING',
  Ready = 'READY',
  PickedUp = 'PICKED_UP',
  InDelivery = 'IN_DELIVERY',
  Delivered = 'DELIVERED',
  Completed = 'COMPLETED',
  // Transient: a DELIVERY order whose driver search timed out (~15 min) and
  // is now awaiting the buyer's decision (switch to pickup, or cancel+refund).
  NoDriverAvailable = 'NO_DRIVER_AVAILABLE',
  Cancelled = 'CANCELLED',
  Refunded = 'REFUNDED',
  Disputed = 'DISPUTED',
}
