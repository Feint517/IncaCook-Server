import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { AuthError, Session, User } from '@supabase/supabase-js';

import { supabaseConfig } from '@config/supabase.config';

import { PrismaService } from '@infrastructure/database/prisma.service';
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
    private readonly prisma: PrismaService,
    @Inject(supabaseConfig.KEY)
    private readonly cfg: ConfigType<typeof supabaseConfig>,
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

  /**
   * Temporary SMS-OTP bypass: sends a 6-digit code to the caller's own
   * email (resolved from the JWT, never the body) via Supabase's email
   * OTP. Pair with `verifyEmailOtp` to flip `User.phoneVerified` without
   * an SMS roundtrip. Remove both methods + endpoints once the SMS
   * provider is back.
   */
  async requestEmailOtp(email: string): Promise<void> {
    const { error } = await this.anon.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      throw this.toHttpException(error, 'email OTP request failed');
    }
  }

  /**
   * Verifies the email OTP, then mirrors a verified phone signal onto the
   * caller's User row (`phoneVerified = true`) so downstream gates that
   * previously required SMS proof are satisfied. Returns the fresh
   * Supabase session minted by verifyOtp.
   */
  async verifyEmailOtp(
    supabaseId: string,
    email: string,
    code: string,
  ): Promise<SessionResponseDto> {
    const { data, error } = await this.anon.client.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error || !data.session) {
      throw this.toHttpException(
        error ?? ({ message: 'OTP verification failed', status: 401 } as AuthError),
        'email OTP verify failed',
      );
    }

    await this.prisma.db.user.update({
      where: { supabaseId },
      data: { phoneVerified: true },
    });

    return this.toSession(data.session);
  }

  /**
   * Attaches a phone number to the authenticated user and triggers an OTP
   * send. Calling again with a different phone overwrites the pending
   * phone (Supabase last-write-wins on phone_change_token). The supabase-js
   * SDK doesn't expose a user-context update without juggling sessions on
   * a stateless backend, so we hit the REST API directly with the user's
   * own Bearer token.
   */
  async requestPhoneOtp(accessToken: string, phone: string): Promise<void> {
    const response = await fetch(`${this.cfg.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: this.cfg.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone }),
    });
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw this.mapSupabaseHttpError(response.status, body, 'phone OTP request failed');
    }
  }

  /**
   * Confirms the OTP, marking the phone as verified on Supabase's
   * auth.users and mirroring the value onto our User table.
   *
   * Supabase's verify returns a fresh session (the user's `aal` may bump
   * after MFA verify), so we surface it — the client can swap tokens to
   * keep `phoneConfirmedAt` up-to-date in subsequent /me reads.
   */
  async verifyPhoneOtp(
    accessToken: string,
    phone: string,
    code: string,
  ): Promise<SessionResponseDto> {
    const response = await fetch(`${this.cfg.url}/auth/v1/verify`, {
      method: 'POST',
      headers: {
        apikey: this.cfg.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone, token: code, type: 'phone_change' }),
    });
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw this.mapSupabaseHttpError(response.status, body, 'phone OTP verify failed');
    }

    const raw = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at?: number;
      user: {
        id: string;
        email: string | null;
        phone: string | null;
        email_confirmed_at: string | null;
        phone_confirmed_at: string | null;
      };
    };

    // Supabase stores phone in stripped form (no leading `+`); we store
    // canonical E.164 so clients can display it without further transforms.
    const canonicalPhone = raw.user.phone
      ? raw.user.phone.startsWith('+')
        ? raw.user.phone
        : `+${raw.user.phone}`
      : null;

    await this.prisma.db.user.update({
      where: { supabaseId: raw.user.id },
      data: {
        phone: canonicalPhone,
        phoneVerified: raw.user.phone_confirmed_at !== null,
      },
    });

    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresAt: raw.expires_at ?? 0,
      user: {
        id: raw.user.id,
        email: raw.user.email,
        phone: canonicalPhone,
        emailConfirmedAt: raw.user.email_confirmed_at,
        phoneConfirmedAt: raw.user.phone_confirmed_at,
      },
    };
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

  /**
   * Like `toHttpException` but for raw REST responses (used for phone OTP,
   * where we hit /auth/v1/user and /auth/v1/verify directly).
   */
  private mapSupabaseHttpError(
    status: number,
    body: { error_code?: string; msg?: string; message?: string; error?: string },
    fallback: string,
  ): HttpException {
    const code = body.error_code ?? body.error ?? '';
    const message = body.msg ?? body.message ?? body.error ?? 'Unknown error';
    if (status === 401 || code === 'otp_expired' || code === 'invalid_otp') {
      return new UnauthorizedException(message);
    }
    if (status === 422 || code === 'phone_provider_disabled') {
      return new BadRequestException(message);
    }
    if (status === 429) {
      return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (status >= 400 && status < 500) {
      return new BadRequestException(message);
    }
    this.logger.error(`Supabase ${fallback}: status=${status} code=${code} msg=${message}`);
    return new InternalServerErrorException('Authentication service error');
  }
}

async function readErrorBody(
  response: Response,
): Promise<{ error_code?: string; msg?: string; message?: string; error?: string }> {
  try {
    return (await response.json()) as ReturnType<typeof readErrorBody> extends Promise<infer T>
      ? T
      : never;
  } catch {
    return { message: response.statusText };
  }
}
