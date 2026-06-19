import { IsIn } from 'class-validator';

import type { NoDriverDecision } from '../orders.service';

/**
 * Body for `POST /v1/orders/:orderId/no-driver-decision`. The buyer chooses
 * what to do after no driver accepted the delivery within the timeout.
 */
export class NoDriverDecisionDto {
  @IsIn(['SWITCH_TO_PICKUP', 'CANCEL_AND_REFUND'])
  decision!: NoDriverDecision;
}
