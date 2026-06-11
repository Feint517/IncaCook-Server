import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageType, ParticipantRole, Prisma } from '@prisma/client';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { RedisService } from '@infrastructure/redis/redis.service';

import { ConversationsService } from './conversations.service';
import { ListMessagesQueryDto } from './dto/list-messages.query.dto';

export interface PersistedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: ParticipantRole;
  content: string;
  messageType: MessageType;
  createdAt: Date;
}

/**
 * Persisted-message API. Each send writes a `Message` row, updates
 * the conversation's last-message snapshot, increments unread for
 * every participant except the sender, and publishes the payload to
 * the realtime fan-out (`conv:<id>:msg` Redis channel → `message:new`
 * socket event on the matching room).
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly conversations: ConversationsService,
  ) {}

  async send(
    supabaseId: string,
    conversationId: string,
    content: string,
    messageType: MessageType = MessageType.TEXT,
  ): Promise<PersistedMessage> {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new ForbiddenException('Empty messages are not allowed');
    }
    if (trimmed.length > 4000) {
      throw new ForbiddenException('Message too long (max 4000 chars)');
    }

    const { callerUserId } = await this.conversations.assertParticipant(supabaseId, conversationId);
    // Fetch the caller's role on this conversation for the broadcast
    // payload (used by clients to align bubbles correctly).
    const me = await this.prisma.db.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: callerUserId } },
      select: { role: true },
    });
    if (!me) {
      throw new NotFoundException('Participant row missing');
    }

    const messageId = generateUlid();
    const now = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.message.create({
          data: {
            id: messageId,
            conversationId,
            senderId: callerUserId,
            content: trimmed,
            messageType,
            createdAt: now,
          },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessage: trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed,
            lastMessageAt: now,
          },
        });
        // Bump unread for the OTHER participants only.
        await tx.conversationParticipant.updateMany({
          where: {
            conversationId,
            userId: { not: callerUserId },
          },
          data: { unreadCount: { increment: 1 } },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.warn(`message persist failed: ${err.message}`);
      }
      throw err;
    }

    const payload: PersistedMessage = {
      id: messageId,
      conversationId,
      senderId: callerUserId,
      senderRole: me.role,
      content: trimmed,
      messageType,
      createdAt: now,
    };
    await this.publish(conversationId, payload);
    return payload;
  }

  /**
   * Paginated history, newest first. Uses ULID cursor pagination —
   * pass the oldest already-fetched message id as `before` to load
   * the next page back in time.
   */
  async listMessages(
    supabaseId: string,
    conversationId: string,
    query: ListMessagesQueryDto,
  ): Promise<PersistedMessage[]> {
    await this.conversations.assertParticipant(supabaseId, conversationId);
    const limit = Math.min(query.limit ?? 50, 200);
    const rows = await this.prisma.db.message.findMany({
      where: {
        conversationId,
        ...(query.before ? { id: { lt: query.before } } : {}),
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        messageType: true,
        createdAt: true,
        sender: {
          select: {
            chatParticipations: {
              where: { conversationId },
              select: { role: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderRole: m.sender.chatParticipations[0]?.role ?? ParticipantRole.BUYER,
      content: m.content,
      messageType: m.messageType,
      createdAt: m.createdAt,
    }));
  }

  private async publish(conversationId: string, payload: PersistedMessage): Promise<void> {
    try {
      await this.redis.client.publish(`conv:${conversationId}:msg`, JSON.stringify(payload));
    } catch (err) {
      this.logger.warn(`conv publish failed for ${conversationId}: ${(err as Error).message}`);
    }
  }
}
