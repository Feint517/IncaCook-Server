import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { UserRole } from '@common/enums/user-role.enum';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';
import type { JwtPayload } from '@common/types/jwt-payload.type';

import { supabaseConfig } from '@config/supabase.config';

@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(supabaseConfig.KEY) cfg: ConfigType<typeof supabaseConfig>) {
    if (!cfg.jwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET is required');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.jwtSecret,
      audience: 'authenticated',
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return {
      id: payload.sub,
      email: payload.email,
      phone: payload.phone,
      role: (payload.role as UserRole) ?? UserRole.Buyer,
    };
  }
}
