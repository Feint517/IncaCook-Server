import { Module } from '@nestjs/common';

import { NotificationsModule } from '@modules/notifications/notifications.module';

import { ConversationsService } from './conversations.service';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({
  imports: [NotificationsModule], // MessagingService pushes new-message notifications
  controllers: [MessagingController],
  providers: [ConversationsService, MessagingService],
  exports: [ConversationsService, MessagingService],
})
export class MessagingModule {}
