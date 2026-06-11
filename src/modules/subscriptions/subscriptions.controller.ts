import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import {
  SubscriptionIntentResponseDto,
  SubscriptionResponseDto,
  SubscriptionUrlResponseDto,
} from './dto/subscription-response.dto';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Seller platform subscription ($4/mo). All routes are seller-scoped to
 * the JWT. Webhooks (StripeWebhookHandlerService) are the source of truth
 * for status; these endpoints only start Checkout / open the Portal / read.
 */
@Controller({ path: 'sellers/me/subscription', version: '1' })
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** Current subscription status + renewal date + active flag. */
  @Get()
  getStatus(@CurrentUser() jwtUser: AuthenticatedUser): Promise<SubscriptionResponseDto> {
    return this.subscriptions.getStatus(jwtUser.id);
  }

  /** In-app subscribe: returns the PaymentIntent client secret to confirm
   *  the card with `flutter_stripe` (same as buyer checkout). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createSubscription(
    @CurrentUser() jwtUser: AuthenticatedUser,
  ): Promise<SubscriptionIntentResponseDto> {
    return this.subscriptions.createSubscription(jwtUser.id);
  }

  /** Opens the Stripe Billing Portal (update card / cancel / invoices). */
  @Post('portal')
  @HttpCode(HttpStatus.CREATED)
  createPortal(@CurrentUser() jwtUser: AuthenticatedUser): Promise<SubscriptionUrlResponseDto> {
    return this.subscriptions.createPortalSession(jwtUser.id);
  }
}
