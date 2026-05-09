import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import type { AuthenticatedRequest } from '@common/types/authenticated-request.type';

/**
 * Throttler guard that keys on user ID when authenticated and falls back to
 * IP address otherwise.
 */
@Injectable()
export class IncaCookThrottleGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as Partial<AuthenticatedRequest>;
    if (request.user?.id) {
      return `user:${request.user.id}`;
    }
    return `ip:${request.ip ?? 'unknown'}`;
  }
}
