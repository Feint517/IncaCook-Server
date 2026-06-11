import { Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';

import { UserRole } from '@common/enums/user-role.enum';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';
import type { JwtPayload } from '@common/types/jwt-payload.type';

import { supabaseConfig } from '@config/supabase.config';

/**
 * Imperative Supabase JWT verifier used by the WebSocket gateway. Mirrors
 * SupabaseJwtStrategy (passport-jwt) for HTTP — kept as a small parallel
 * implementation because passport's lifecycle doesn't fit the socket
 * handshake.
 */
@Injectable()
export class WsJwtService implements OnModuleInit {
  private jwks!: JwksClient;

  constructor(
    @Inject(supabaseConfig.KEY) private readonly cfg: ConfigType<typeof supabaseConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.url) {
      throw new Error('SUPABASE_URL is required for WsJwtService');
    }
    this.jwks = new JwksClient({
      jwksUri: `${this.cfg.url}/auth/v1/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
    });
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') {
      throw new UnauthorizedException('Malformed JWT');
    }
    const alg = decoded.header.alg;
    const kid = decoded.header.kid;

    let key: string;
    if (alg === 'HS256') {
      if (!this.cfg.jwtSecret) {
        throw new UnauthorizedException('HS256 rejected: SUPABASE_JWT_SECRET not configured');
      }
      key = this.cfg.jwtSecret;
    } else if (alg === 'ES256' || alg === 'RS256') {
      if (!kid) throw new UnauthorizedException('Asymmetric JWT missing kid');
      const signing = await this.jwks.getSigningKey(kid);
      key = signing.getPublicKey();
    } else {
      throw new UnauthorizedException(`Unsupported JWT alg: ${alg}`);
    }

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, key, {
        algorithms: ['HS256', 'ES256', 'RS256'],
        audience: 'authenticated',
      }) as JwtPayload;
    } catch (err) {
      throw new UnauthorizedException(`JWT invalid: ${(err as Error).message}`);
    }

    if (!payload.sub) throw new UnauthorizedException('Invalid token payload');
    return {
      id: payload.sub,
      email: payload.email,
      phone: payload.phone && payload.phone.length > 0 ? payload.phone : undefined,
      role: (payload.role as UserRole) ?? UserRole.Buyer,
    };
  }
}
