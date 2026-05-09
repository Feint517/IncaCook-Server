import { UserRole } from '@common/enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  email?: string;
  phone?: string;
  role?: UserRole;
  aud?: string;
  exp?: number;
  iat?: number;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}
