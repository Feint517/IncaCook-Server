import { Module } from '@nestjs/common';

import { NotificationsModule } from '@modules/notifications/notifications.module';

import { StrikesService } from './strikes.service';

/**
 * Reusable strike/exclusion engine. Imported by modules that record strikes
 * (orders/deliveries incident hooks) and by the admin module. PrismaService is
 * global; NotificationsModule provides the suspension push.
 */
@Module({
  imports: [NotificationsModule],
  providers: [StrikesService],
  exports: [StrikesService],
})
export class StrikesModule {}
