import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '@common/types/authenticated-request.type';

export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthenticatedUser | undefined,
    ctx: ExecutionContext,
  ): AuthenticatedUser | unknown => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
