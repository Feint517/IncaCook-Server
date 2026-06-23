import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

/** Fields surfaced to the admin sanctions UI — no secrets. */
const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  isSuspended: true,
  suspendedAt: true,
  suspensionReason: true,
  createdAt: true,
  // Seller rating aggregates — useful context for rating-based suspensions.
  sellerProfile: { select: { averageRating: true, reviewCount: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** Flattens the seller rating aggregates to top-level fields. */
function toResponse(u: UserRow) {
  const { sellerProfile, ...rest } = u;
  return {
    ...rest,
    averageRating: sellerProfile?.averageRating ?? null,
    reviewCount: sellerProfile?.reviewCount ?? null,
  };
}

/**
 * Read-only admin user lookup backing the sanctions UI. No business rules — just
 * search + fetch so admins can find a user before adding strikes / suspending.
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Search users by id (exact), or email/name/phone (contains, case-insensitive). */
  async search(query: string | undefined, limit: number, offset: number) {
    const q = query?.trim();
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { id: q },
            { email: { contains: q, mode: 'insensitive' } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        }
      : {};
    const users = await this.prisma.db.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return users.map(toResponse);
  }

  /** Single user (for refreshing the selected user after an action). */
  async getById(id: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return toResponse(user);
  }
}
