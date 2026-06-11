import { Module } from '@nestjs/common';

import { ConversationsService } from './conversations.service';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({
  controllers: [MessagingController],
  providers: [ConversationsService, MessagingService],
  exports: [ConversationsService, MessagingService],
})
export class MessagingModule {}
