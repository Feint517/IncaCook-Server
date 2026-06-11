import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { NotificationsService } from '@modules/notifications/notifications.service';

import { DashboardService } from '../stats/dashboard.service';
import { NotificationTarget, SendAdminNotificationDto } from './dto/send-admin-notification.dto';

export interface AdminNotificationResult {
  target: NotificationTarget;
  targetedUsers: number;
  tokensFound: number;
  sent: number;
  failed: number;
  invalidRemoved: number;
}

/**
 * Resolves an admin audience selector to a concrete set of user ids, then
 * fans the push out via the shared NotificationsService (which reuses the
 * DeviceToken table + FcmService and prunes dead tokens).
 */
@Injectable()
export class AdminNotificationsService {
  private readonly logger = new Logger(AdminNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly dashboard: DashboardService,
  ) {}

  async send(dto: SendAdminNotificationDto): Promise<AdminNotificationResult> {
    const userIds = await this.resolveTargetUserIds(dto);

    // FCM data values must be strings.
    const data: Record<string, string> = { type: 'admin_broadcast' };
    for (const [k, v] of Object.entries(dto.data ?? {})) {
      data[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }

    this.logger.log(`[admin-push] target=${dto.target} resolved ${userIds.length} user(s)`);

    const counts = await this.notifications.sendToUsers(userIds, {
      title: dto.title,
      body: dto.body,
      data,
    });

    return { target: dto.target, targetedUsers: userIds.length, ...counts };
  }

  private async resolveTargetUserIds(dto: SendAdminNotificationDto): Promise<string[]> {
    switch (dto.target) {
      case NotificationTarget.All:
        return this.userIdsWhere({});
      case NotificationTarget.Buyers:
        return this.userIdsWhere({ role: 'BUYER' });
      case NotificationTarget.Sellers:
        return this.userIdsWhere({ role: 'SELLER' });
      case NotificationTarget.Drivers:
        return this.userIdsWhere({ role: 'DRIVER' });
      case NotificationTarget.RecurringUsers:
        return this.dashboard.recurringUserIds();
      case NotificationTarget.MonoUsers:
        return this.dashboard.monoUserIds();
      case NotificationTarget.TopSellers:
        return this.dashboard.topSellerIds();
      case NotificationTarget.Category: {
        if (!dto.category) {
          throw new BadRequestException('category is required for target=CATEGORY');
        }
        const rows = await this.prisma.db.sellerProfile.findMany({
          where: { category: dto.category },
          select: { userId: true },
        });
        return rows.map((r) => r.userId);
      }
      case NotificationTarget.City: {
        if (!dto.city) {
          throw new BadRequestException('city is required for target=CITY');
        }
        const rows = await this.prisma.db.address.findMany({
          where: { city: dto.city },
          select: { userId: true },
          distinct: ['userId'],
        });
        return rows.map((r) => r.userId);
      }
    }
  }

  private async userIdsWhere(where: { role?: 'BUYER' | 'SELLER' | 'DRIVER' }): Promise<string[]> {
    const rows = await this.prisma.db.user.findMany({
      where: { ...where, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
