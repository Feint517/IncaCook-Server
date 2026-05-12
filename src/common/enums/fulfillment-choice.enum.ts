/**
 * Buyer's choice at checkout. Subset of `Fulfillment` (which describes what
 * the seller offers — DELIVERY | PICKUP | BOTH); the order itself can only
 * be one or the other.
 */
export enum FulfillmentChoice {
  Delivery = 'DELIVERY',
  Pickup = 'PICKUP',
}
