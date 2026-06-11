import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import { RolesGuard } from '@common/guards/roles.guard';

import { AdminNotificationResult, AdminNotificationsService } from './admin-notifications.service';
import { SendAdminNotificationDto } from './dto/send-admin-notification.dto';

/** Admin mass / targeted notifications. ADMIN only. */
@Controller({ path: 'admin/notifications', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class AdminNotificationsController {
  constructor(private readonly adminNotifications: AdminNotificationsService) {}

  /**
   * `POST /v1/admin/notifications/send` — push to a targeted audience.
   * Returns delivery counts; safe against invalid tokens (pruned).
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  send(@Body() dto: SendAdminNotificationDto): Promise<AdminNotificationResult> {
    return this.adminNotifications.send(dto);
  }
}
