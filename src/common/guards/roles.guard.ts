import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import type { AuthenticatedRequest } from '@common/types/authenticated-request.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException(`Requires role: ${required.join(', ')}`);
    }
    return true;
  }
}
