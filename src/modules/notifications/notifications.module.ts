import { Module } from '@nestjs/common';

import { FcmModule } from '@infrastructure/notifications/push/fcm.module';

import { DeviceTokensController } from './device-tokens.controller';
import { DeviceTokensService } from './device-tokens.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Device-token registration + the developer test-push endpoint. Exports
 * [DeviceTokensService] so future per-event dispatchers (orders, messaging,
 * deliveries) can resolve a user's tokens without duplicating that logic.
 */
@Module({
  imports: [FcmModule],
  controllers: [DeviceTokensController, NotificationsController],
  providers: [DeviceTokensService, NotificationsService],
  exports: [DeviceTokensService, NotificationsService],
})
export class NotificationsModule {}
