import { Module } from '@nestjs/common';

import { IdempotencyService } from '@common/services/idempotency.service';

import { NotificationsModule } from '@modules/notifications/notifications.module';
import { StrikesModule } from '@modules/strikes/strikes.module';
import { WalletsModule } from '@modules/wallets/wallets.module';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [NotificationsModule, WalletsModule, StrikesModule],
  controllers: [OrdersController],
  providers: [OrdersService, IdempotencyService],
  exports: [OrdersService],
})
export class OrdersModule {}
