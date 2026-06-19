import { Module } from '@nestjs/common';

import { NotificationsModule } from '@modules/notifications/notifications.module';

import { AdminOrderFinancialsController, WalletController } from './wallets.controller';
import { WalletService } from './wallets.service';

/**
 * Internal wallet ledger: credits seller/driver on order completion (never on
 * payment), exposes balances, and performs Stripe Connect transfers only on
 * withdrawal (>= 50 €). PrismaService + StripeService are global. Exports
 * WalletService so OrdersService can credit on delivery / reception.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [WalletController, AdminOrderFinancialsController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletsModule {}
