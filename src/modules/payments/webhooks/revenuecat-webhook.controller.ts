import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { Public } from '@common/decorators/public.decorator';

import { revenueCatConfig } from '@config/revenuecat.config';

import { RevenueCatWebhookHandlerService } from './revenuecat-webhook-handler.service';

import type { RevenueCatWebhookBody } from './revenuecat-webhook-handler.service';
import type { ConfigType } from '@nestjs/config';

/**
 * RevenueCat → us. Public (no JWT) but authenticated by the shared
 * `Authorization` header value configured in the RevenueCat dashboard
 * (Project → Webhooks → Authorization header). RevenueCat does not sign the
 * body, so the header IS the verification. Always 200 quickly so RevenueCat
 * doesn't retry on slow handlers.
 */
@Controller({ path: 'webhooks/revenuecat', version: '1' })
export class RevenueCatWebhookController {
  private readonly logger = new Logger(RevenueCatWebhookController.name);

  constructor(
    private readonly handler: RevenueCatWebhookHandlerService,
    @Inject(revenueCatConfig.KEY)
    private readonly cfg: ConfigType<typeof revenueCatConfig>,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: RevenueCatWebhookBody,
  ): Promise<{ received: true }> {
    const expected = this.cfg.webhookAuthToken;
    // Refuse unless a token is configured AND matches — never run an open
    // endpoint that mutates subscription state.
    if (!expected || authorization !== expected) {
      this.logger.warn('RevenueCat webhook rejected: missing/invalid Authorization header');
      throw new UnauthorizedException('Invalid RevenueCat webhook authorization');
    }
    await this.handler.handleEvent(body);
    return { received: true };
  }
}
