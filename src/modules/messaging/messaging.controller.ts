import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { ConversationListItem, ConversationsService } from './conversations.service';
import { FindOrCreateConversationDto } from './dto/find-or-create-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations.query.dto';
import { ListMessagesQueryDto } from './dto/list-messages.query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagingService, PersistedMessage } from './messaging.service';

@Controller({ version: '1' })
export class MessagingController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messaging: MessagingService,
  ) {}

  /**
   * `POST /v1/conversations` — find-or-create. Idempotent per
   * (type, orderId, participant pair). Returns `{id, type}`.
   */
  @Post('conversations')
  @HttpCode(HttpStatus.OK)
  async findOrCreate(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: FindOrCreateConversationDto,
  ) {
    return this.conversations.findOrCreate(jwtUser.id, dto);
  }

  /**
   * `GET /v1/conversations` — list all conversations the caller
   * participates in. Pass `?type=BUYER_SELLER` from the seller
   * messages screen to hide BUYER_DELIVERY / SUPPORT threads.
   */
  @Get('conversations')
  async list(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ConversationListItem[]> {
    return this.conversations.listForUser(jwtUser.id, query);
  }

  /** Paginated message history (newest first; cursor via `before`). */
  @Get('conversations/:id/messages')
  async listMessages(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<PersistedMessage[]> {
    return this.messaging.listMessages(jwtUser.id, conversationId, query);
  }

  /** Send a message. Server persists + broadcasts via socket. */
  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendMessage(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
  ): Promise<PersistedMessage> {
    return this.messaging.send(jwtUser.id, conversationId, dto.text);
  }

  /** Reset the caller's unread counter on this conversation. */
  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') conversationId: string,
  ): Promise<void> {
    await this.conversations.markRead(jwtUser.id, conversationId);
  }
}
