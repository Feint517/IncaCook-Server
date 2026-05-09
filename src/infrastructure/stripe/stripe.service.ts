import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Stripe from 'stripe';

import { stripeConfig } from '@config/stripe.config';

@Injectable()
export class StripeService {
  public readonly client: Stripe;

  constructor(@Inject(stripeConfig.KEY) private readonly cfg: ConfigType<typeof stripeConfig>) {
    this.client = new Stripe(this.cfg.secretKey, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });
  }
}
