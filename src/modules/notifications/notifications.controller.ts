import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { NotificationsService, TestNotificationResult } from './notifications.service';

/** Authenticated notification utilities. v1 ships only the test endpoint. */
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * `POST /v1/notifications/test` — fires a canned push to every device the
   * caller has registered. Returns counts so the caller can tell whether FCM
   * is configured and how many tokens were targeted.
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  sendTest(@CurrentUser() jwtUser: AuthenticatedUser): Promise<TestNotificationResult> {
    return this.notifications.sendTestToUser(jwtUser.id);
  }
}
