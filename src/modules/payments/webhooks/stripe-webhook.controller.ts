import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '@common/decorators/public.decorator';

import { StripeWebhookService } from '@infrastructure/stripe/stripe-webhook.service';

import { StripeWebhookHandlerService } from './stripe-webhook-handler.service';

@Controller({ path: 'stripe/webhook', version: '1' })
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeWebhook: StripeWebhookService,
    private readonly handler: StripeWebhookHandlerService,
  ) {}

  /**
   * Stripe → us. Public (no JWT) but signature-verified against the raw
   * request body and the STRIPE_WEBHOOK_SECRET.
   *
   * The 200 response must be returned quickly — Stripe retries on timeouts.
   * Heavy work should be queued; for now the handlers are quick.
   */
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!request.rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    let event;
    try {
      event = this.stripeWebhook.constructEvent(request.rawBody, signature);
    } catch (err) {
      // 400 so Stripe can see the failure; do NOT 500 (would trigger retries).
      this.logger.warn(`Stripe signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException('Invalid Stripe signature');
    }

    await this.handler.handleEvent(event);

    return { received: true };
  }
}
