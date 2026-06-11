import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import type { AuthenticatedRequest } from '@common/types/authenticated-request.type';

import { PrismaService } from '@infrastructure/database/prisma.service';

/**
 * Role-gating guard. Resolves the JWT user's role from the database (the
 * truth) rather than the JWT claim (which defaults to BUYER if missing).
 * The DB lookup runs only when an endpoint declares `@Roles(...)` — most
 * routes pay nothing.
 *
 * Side effect: on success, mutates `request.user.role` to the DB-truth
 * value so downstream handlers see the real role.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new ForbiddenException('Authentication required');
    }

    const dbUser = await this.prisma.db.user.findUnique({
      where: { supabaseId: request.user.id },
      select: { role: true },
    });
    if (!dbUser) {
      throw new ForbiddenException('User not found');
    }

    const dbRole = dbUser.role as UserRole;
    if (!required.includes(dbRole)) {
      throw new ForbiddenException(`Requires role: ${required.join(', ')}`);
    }

    // Mutate the request so handlers see the verified role downstream.
    request.user.role = dbRole;
    return true;
  }
}
