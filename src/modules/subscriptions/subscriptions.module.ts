import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { stripeConfig } from '@config/stripe.config';

import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Mandatory seller platform subscription ($4/mo) via Stripe Checkout +
 * Billing Portal. `StripeService` and `PrismaService` are global; we only
 * need the stripe config here for the price id / redirect URLs.
 */
@Module({
  imports: [ConfigModule.forFeature(stripeConfig)],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
