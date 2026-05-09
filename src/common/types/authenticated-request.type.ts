import { UserRole } from '@common/enums/user-role.enum';

import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  phone?: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  correlationId: string;
}
