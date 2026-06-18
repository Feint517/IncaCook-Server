import { Module } from '@nestjs/common';

import { MessagingModule } from '@modules/messaging/messaging.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';

import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

@Module({
  imports: [
    OrdersModule, // for OrdersService.confirmDeliveredByDriver
    NotificationsModule, // for per-event delivery push notifications
    MessagingModule, // for ConversationsService.ensureSellerDriverConversation
  ],
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
