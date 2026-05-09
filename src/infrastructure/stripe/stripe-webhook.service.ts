import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Stripe from 'stripe';

import { stripeConfig } from '@config/stripe.config';

import { StripeService } from './stripe.service';

@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly stripe: StripeService,
    @Inject(stripeConfig.KEY) private readonly cfg: ConfigType<typeof stripeConfig>,
  ) {}

  /**
   * Verifies the Stripe-Signature header against the raw request body.
   * Throws if signature is invalid or the timestamp drift is too large.
   */
  constructEvent(payload: Buffer | string, signature: string): Stripe.Event {
    return this.stripe.client.webhooks.constructEvent(payload, signature, this.cfg.webhookSecret);
  }
}
