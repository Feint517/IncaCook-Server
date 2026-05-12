import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthError, Session, User } from '@supabase/supabase-js';

import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';
import { SupabaseService } from '@infrastructure/supabase/supabase.service';

import { SessionResponseDto } from './dto/session-response.dto';

/**
 * Thin proxy in front of Supabase Auth. The Flutter app only ever talks to
 * /v1/auth/*; it never sees the Supabase URL or anon key. This isolates the
 * client from the auth provider so we can swap Supabase out later without
 * touching the app.
 *
 * Strategy:
 *   - User-context operations (signup, signin, refresh, password reset
 *     request) go through the anon client.
 *   - Privileged operations (signout for a specific session, update the
 *     password of an identified user) go through the admin client so we
 *     don't have to juggle session state on a stateless backend.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly anon: SupabaseService,
    private readonly admin: SupabaseAdminService,
  ) {}

  async signUp(email: string, password: string): Promise<SessionResponseDto> {
    const { data, error } = await this.anon.client.auth.signUp({ email, password });
    if (error) {
      throw this.toHttpException(error, 'signup failed');
    }
    if (!data.session) {
      // Email confirmation required by Supabase config. We don't return a
      // session here — caller must re-signin once they've confirmed.
      throw new BadRequestException(
        'Account created — confirm your email before signing in',
      );
    }
    return this.toSession(data.session);
  }

  async signIn(email: string, password: string): Promise<SessionResponseDto> {
    const { data, error } = await this.anon.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.session) {
      throw new UnauthorizedException(error?.message ?? 'Invalid email or password');
    }
    return this.toSession(data.session);
  }

  async refresh(refreshToken: string): Promise<SessionResponseDto> {
    const { data, error } = await this.anon.client.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session) {
      throw new UnauthorizedException(error?.message ?? 'Refresh token invalid or expired');
    }
    return this.toSession(data.session);
  }

  /**
   * Signs out the session whose access token is passed. Default scope
   * 'local' invalidates only this refresh token; 'global' kicks every
   * session for the user (useful for "log me out everywhere").
   */
  async signOut(accessToken: string, scope: 'local' | 'global'): Promise<void> {
    const { error } = await this.admin.client.auth.admin.signOut(accessToken, scope);
    if (error) {
      // Idempotency: an already-revoked token shouldn't be an error to the
      // client. Log + swallow.
      this.logger.warn(`signOut warning (treating as no-op): ${error.message}`);
    }
  }

  async requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
    // Supabase returns success even for unknown emails, so this naturally
    // doesn't leak existence.
    const { error } = await this.anon.client.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      // Rate-limit errors are still useful to surface so the app can show
      // "try again in a minute".
      throw this.toHttpException(error, 'password reset request failed');
    }
  }

  /**
   * Sets a new password for the user identified by `userId` (taken from the
   * verified JWT). Used by both the "I forgot my password" recovery flow
   * (where the Bearer comes from the email magic link) and the normal
   * "change password while signed in" flow.
   */
  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const { error } = await this.admin.client.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (error) {
      throw this.toHttpException(error, 'password update failed');
    }
  }

  // -------------------- internals --------------------

  private toSession(session: Session): SessionResponseDto {
    const user = session.user as User;
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at ?? 0,
      user: {
        id: user.id,
        email: user.email ?? null,
        phone: user.phone ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
        phoneConfirmedAt: user.phone_confirmed_at ?? null,
      },
    };
  }

  /**
   * Map Supabase AuthError → HttpException with a useful status. The
   * `code` taxonomy is documented at
   * https://supabase.com/docs/reference/javascript/auth-error-codes.
   */
  private toHttpException(error: AuthError, fallback: string): HttpException {
    const code = error.code ?? '';
    const status = error.status ?? 500;
    if (code === 'weak_password') return new BadRequestException(error.message);
    if (code === 'email_exists' || code === 'user_already_exists') {
      return new ConflictException(error.message);
    }
    if (code === 'over_email_send_rate_limit' || status === 429) {
      return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (status >= 400 && status < 500) {
      return new BadRequestException(error.message);
    }
    this.logger.error(`Supabase auth ${fallback}: ${error.message} (code=${code} status=${status})`);
    return new InternalServerErrorException('Authentication service error');
  }
}
