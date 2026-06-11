import { Injectable, NotFoundException } from '@nestjs/common';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

/**
 * Owns the `DeviceToken` table: registering, unregistering, and listing a
 * user's FCM tokens. The JWT carries the Supabase id, so every entry point
 * resolves it to the local `User.id` (the FK target) first.
 */
@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers (or refreshes) an FCM token for the current user. `token` is
   * unique, so re-posting an existing token re-points it at this user — e.g.
   * the same device after a re-login or account switch — and bumps
   * `updatedAt`, rather than inserting a duplicate row.
   */
  async register(supabaseId: string, dto: RegisterDeviceTokenDto): Promise<void> {
    const userId = await this.resolveUserId(supabaseId);
    await this.prisma.db.deviceToken.upsert({
      where: { token: dto.token },
      create: {
        id: generateUlid(),
        token: dto.token,
        platform: dto.platform,
        userId,
      },
      update: {
        platform: dto.platform,
        userId,
      },
    });
  }

  /**
   * Unregisters a token for the current user (e.g. on logout). Scoped to the
   * caller so one user can't delete another's token; a missing token is a
   * no-op rather than a 404.
   */
  async remove(supabaseId: string, token: string): Promise<void> {
    const userId = await this.resolveUserId(supabaseId);
    await this.prisma.db.deviceToken.deleteMany({ where: { token, userId } });
  }

  /** Every registered FCM token for a local `User.id`. */
  async listTokensForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.db.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  /** Token rows (id + token) for a set of users — for bulk sends + pruning. */
  async tokensForUsers(userIds: string[]): Promise<Array<{ id: string; token: string }>> {
    if (userIds.length === 0) return [];
    return this.prisma.db.deviceToken.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, token: true },
    });
  }

  /** Removes dead tokens by id (called after a send finds them invalid). */
  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.prisma.db.deviceToken.deleteMany({
      where: { id: { in: ids } },
    });
    return res.count;
  }

  /** Resolves a Supabase auth id (JWT `sub`) to the local `User.id`. */
  async resolveUserId(supabaseId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    return user.id;
  }
}
