export const QueueNames = {
  Notifications: 'notifications',
  ListingExpiration: 'listing-expiration',
  OrderTimeout: 'order-timeout',
  DeliveryMatching: 'delivery-matching',
  SubscriptionBilling: 'subscription-billing',
  Payouts: 'payouts',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export const ALL_QUEUES: QueueName[] = Object.values(QueueNames);
