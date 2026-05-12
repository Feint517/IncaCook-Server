import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { stripeConfig } from '@config/stripe.config';

import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { StripeWebhookHandlerService } from './webhooks/stripe-webhook-handler.service';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';

@Module({
  imports: [ConfigModule.forFeature(stripeConfig)],
  controllers: [OnboardingController, StripeWebhookController],
  providers: [OnboardingService, StripeWebhookHandlerService],
  exports: [OnboardingService],
})
export class PaymentsModule {}
