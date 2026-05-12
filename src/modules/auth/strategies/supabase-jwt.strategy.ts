import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwksClient } from 'jwks-rsa';

import { UserRole } from '@common/enums/user-role.enum';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';
import type { JwtPayload } from '@common/types/jwt-payload.type';

import { supabaseConfig } from '@config/supabase.config';

/**
 * Verifies JWTs from Supabase Auth. Supabase now mints tokens with
 * asymmetric ES256 keys served from /auth/v1/.well-known/jwks.json — we
 * resolve those at request time. The legacy HS256 path (signed with the
 * shared SUPABASE_JWT_SECRET) is kept so scripts/mint-test-jwt.ts keeps
 * working for unit tests + the smoke test.
 *
 * Dispatch is based on the JWT header's `alg` field:
 *   - HS256  → SUPABASE_JWT_SECRET (legacy / test-mint)
 *   - ES256  → JWKS public key by `kid` (Supabase-issued)
 *   - RS256  → JWKS public key by `kid` (in case Supabase switches)
 * Anything else is rejected.
 */
@Injectable()
export class SupabaseJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(supabaseConfig.KEY) cfg: ConfigType<typeof supabaseConfig>) {
    if (!cfg.url) {
      throw new Error('SUPABASE_URL is required');
    }

    const jwksClient = new JwksClient({
      jwksUri: `${cfg.url}/auth/v1/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 10 * 60 * 1000, // 10 min — Supabase rotates rarely
      rateLimit: true,
    });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      audience: 'authenticated',
      algorithms: ['HS256', 'ES256', 'RS256'],
      secretOrKeyProvider: (
        _request: unknown,
        rawJwtToken: string,
        done: (err: Error | null, key?: string) => void,
      ): void => {
        let header: { alg?: string; kid?: string };
        try {
          const headerB64 = rawJwtToken.split('.')[0];
          header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
        } catch {
          return done(new UnauthorizedException('Malformed JWT header'));
        }

        if (header.alg === 'HS256') {
          if (!cfg.jwtSecret) {
            return done(
              new UnauthorizedException('HS256 token rejected: SUPABASE_JWT_SECRET not configured'),
            );
          }
          return done(null, cfg.jwtSecret);
        }

        if (header.alg === 'ES256' || header.alg === 'RS256') {
          if (!header.kid) {
            return done(new UnauthorizedException('Asymmetric JWT missing kid'));
          }
          jwksClient
            .getSigningKey(header.kid)
            .then((key) => done(null, key.getPublicKey()))
            .catch((err: Error) => done(err));
          return;
        }

        return done(new UnauthorizedException(`Unsupported JWT alg: ${header.alg}`));
      },
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return {
      id: payload.sub,
      email: payload.email,
      // Supabase emits an empty string when no phone is set; that's a unique
      // constraint violation waiting to happen since User.phone is @unique.
      // Normalize empty → undefined so downstream code stores NULL.
      phone: payload.phone && payload.phone.length > 0 ? payload.phone : undefined,
      role: (payload.role as UserRole) ?? UserRole.Buyer,
    };
  }
}
