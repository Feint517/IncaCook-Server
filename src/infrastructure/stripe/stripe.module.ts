import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { stripeConfig } from '@config/stripe.config';

import { StripeWebhookService } from './stripe-webhook.service';
import { StripeService } from './stripe.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(stripeConfig)],
  providers: [StripeService, StripeWebhookService],
  exports: [StripeService, StripeWebhookService],
})
export class StripeModule {}
