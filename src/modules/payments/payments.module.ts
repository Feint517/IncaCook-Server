import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { revenueCatConfig } from '@config/revenuecat.config';
import { stripeConfig } from '@config/stripe.config';

import { NotificationsModule } from '@modules/notifications/notifications.module';

import { OnboardingController } from './onboarding/onboarding.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { RevenueCatWebhookHandlerService } from './webhooks/revenuecat-webhook-handler.service';
import { RevenueCatWebhookController } from './webhooks/revenuecat-webhook.controller';
import { StripeWebhookHandlerService } from './webhooks/stripe-webhook-handler.service';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';

@Module({
  imports: [
    ConfigModule.forFeature(stripeConfig),
    ConfigModule.forFeature(revenueCatConfig),
    NotificationsModule,
  ],
  controllers: [OnboardingController, StripeWebhookController, RevenueCatWebhookController],
  providers: [OnboardingService, StripeWebhookHandlerService, RevenueCatWebhookHandlerService],
  exports: [OnboardingService],
})
export class PaymentsModule {}
