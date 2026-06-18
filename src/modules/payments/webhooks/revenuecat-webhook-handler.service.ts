import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database/prisma.service';

import {
  buildSubscriptionFields,
  pickActiveEntitlement,
  webhookEventToStatus,
} from '@modules/subscriptions/revenuecat.util';

/** Subset of the RevenueCat webhook payload we use. */
export interface RevenueCatWebhookBody {
  event?: {
    type?: string;
    app_user_id?: string;
    original_app_user_id?: string;
    product_id?: string;
    entitlement_id?: string | null;
    entitlement_ids?: string[] | null;
    period_type?: string;
    expiration_at_ms?: number | null;
  };
}

/**
 * Authoritative reconciliation of seller subscription state from RevenueCat
 * webhook events. Writes the SAME gate fields the listing/commission logic
 * reads, so no other module changes are needed:
 *   active entitlement  ⇒ ACTIVE (or TRIALING during trial)
 *   trial               ⇒ TRIALING
 *   expiration          ⇒ EXPIRED
 *   cancellation        ⇒ CANCELED
 *   billing issue       ⇒ PAST_DUE
 */
@Injectable()
export class RevenueCatWebhookHandlerService {
  private readonly logger = new Logger(RevenueCatWebhookHandlerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleEvent(body: RevenueCatWebhookBody): Promise<void> {
    const event = body.event;
    if (!event?.type) return;

    const appUserId = event.app_user_id ?? event.original_app_user_id;
    if (!appUserId) {
      this.logger.warn(`RevenueCat ${event.type} ignored: no app_user_id`);
      return;
    }

    const status = webhookEventToStatus(event.type, event.period_type);
    if (status === null) {
      // TEST / TRANSFER / SUBSCRIBER_ALIAS / etc. — nothing to apply.
      this.logger.debug(`RevenueCat ${event.type} ignored (no status change)`);
      return;
    }

    const entitlementIds =
      event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);
    const fields = buildSubscriptionFields({
      status,
      entitlement: pickActiveEntitlement(entitlementIds),
      productId: event.product_id ?? null,
      expiresAtMs: event.expiration_at_ms ?? null,
      isTrial: (event.period_type ?? '').toUpperCase() === 'TRIAL',
      category: null,
      revenueCatCustomerId: appUserId,
    });

    // app_user_id is our User.id (= SellerProfile.userId). Fall back to a
    // match on the stored customer id in case the SDK logged in under an
    // alias. updateMany is a no-op (count 0) when there's no seller row.
    let result = await this.prisma.db.sellerProfile.updateMany({
      where: { userId: appUserId },
      data: fields,
    });
    if (result.count === 0) {
      result = await this.prisma.db.sellerProfile.updateMany({
        where: { revenueCatCustomerId: appUserId },
        data: fields,
      });
    }
    this.logger.log(
      `RevenueCat ${event.type} → ${status} for ${appUserId} (matched ${result.count})`,
    );
  }
}
