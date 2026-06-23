export const QueueNames = {
  Notifications: 'notifications',
  ListingExpiration: 'listing-expiration',
  OrderTimeout: 'order-timeout',
  DeliveryMatching: 'delivery-matching',
  SubscriptionBilling: 'subscription-billing',
  Payouts: 'payouts',
  WalletRelease: 'wallet-release',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export const ALL_QUEUES: QueueName[] = Object.values(QueueNames);

/**
 * Durable timer job names. Each mirrors an in-process watchdog so the timer
 * survives an API restart. Processors call the existing idempotent service
 * methods — they never duplicate business logic.
 */
export const TimerJobNames = {
  /** → OrdersService.handleNoDriverTimeout(orderId) */
  NoDriverTimeout: 'no_driver_timeout',
  /** → OrdersService.autoCancelNoResponse(orderId) */
  NoDriverBuyerResponseTimeout: 'no_driver_buyer_response_timeout',
  /** → OrdersService.handleDriverDeliveryTimeout(deliveryId) */
  DriverDeliveryTimeout: 'driver_delivery_timeout',
} as const;

export type TimerJobName = (typeof TimerJobNames)[keyof typeof TimerJobNames];

/** → WalletService.releaseDuePendingEntries() */
export const WalletJobNames = {
  WalletReleaseSweep: 'wallet_release_sweep',
} as const;

/** Payload for an order/delivery timer job. Only the relevant id is set. */
export interface OrderTimerJobData {
  orderId?: string;
  deliveryId?: string;
}
