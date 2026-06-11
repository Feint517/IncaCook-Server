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
import { Prisma } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { PreludeVerifyService } from '@infrastructure/notifications/sms/prelude-verify.service';
import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';
import { SupabaseService } from '@infrastructure/supabase/supabase.service';

import { PhoneVerifyResponseDto } from './dto/phone-verify-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';

import type { AuthError, Session, User } from '@supabase/supabase-js';

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
    private readonly prelude: PreludeVerifyService,
  ) {}

  async signUp(email: string, password: string): Promise<SessionResponseDto> {
    const { data, error } = await this.anon.client.auth.signUp({ email, password });
    if (error) {
      throw this.toHttpException(error, 'signup failed');
    }
    if (!data.session) {
      // Email confirmation required by Supabase config. We don't return a
      // session here — caller must re-signin once they've confirmed.
      throw new BadRequestException('Account created — confirm your email before signing in');
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

  /**
   * Mobile-native Google Sign-In. The Flutter app obtains the ID token
   * via the `google_sign_in` plugin and forwards it here; we hand it to
   * Supabase's `signInWithIdToken`, which verifies the JWT signature
   * against Google's JWKS, checks the `aud` against the configured Web
   * client ID (see [auth.external.google] in supabase/config.toml), and
   * returns a Supabase session. If the email already exists as an
   * email-password user, Supabase auto-links the new identity to the
   * existing auth.users row (Google always returns `email_verified=true`,
   * and our email-password signups auto-confirm).
   *
   * First-time Google users land here with a session but **no** User row
   * yet — the Flutter wizard still POSTs `/v1/users` (Gate 2) afterwards
   * to commit role + name + CGU, just like email signup.
   */
  async signInWithGoogle(idToken: string, nonce?: string): Promise<SessionResponseDto> {
    const { data, error } = await this.anon.client.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      ...(nonce ? { nonce } : {}),
    });
    if (error || !data.session) {
      throw this.toHttpException(
        error ?? ({ message: 'Google sign-in failed', status: 401 } as AuthError),
        'google sign-in failed',
      );
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
   * Confirms the 6-digit recovery code sent by `requestPasswordReset` and
   * returns the recovery session. The client then calls
   * `POST /v1/auth/password/update` with the returned `accessToken` as Bearer
   * to set the new password. The code is the same `recovery` OTP Supabase
   * issues for `resetPasswordForEmail`, surfaced via the `{{ .Token }}` email
   * template instead of a link.
   */
  async verifyPasswordResetOtp(email: string, code: string): Promise<SessionResponseDto> {
    const { data, error } = await this.anon.client.auth.verifyOtp({
      email,
      token: code,
      type: 'recovery',
    });
    if (error || !data.session) {
      throw this.toHttpException(
        error ?? ({ message: 'reset code verification failed', status: 401 } as AuthError),
        'password reset OTP verify failed',
      );
    }
    return this.toSession(data.session);
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
   * Sends a 6-digit email verification code to the caller's own email
   * (resolved from the JWT, never the body) via Supabase's email OTP. Pair
   * with `verifyEmailOtp`, which flips `User.emailVerified = true`.
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
   * Verifies the email OTP and marks the caller's email as verified
   * (`emailVerified = true`) on our User row. Returns the fresh Supabase
   * session minted by verifyOtp.
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

    // Best-effort mirror onto our User row. The row may not exist yet
    // (Google sign-in → email OTP before POST /v1/users). That's fine
    // here: Supabase has already set `auth.users.email_confirmed_at`,
    // and UsersService picks that up when the row is eventually created.
    try {
      await this.prisma.db.user.update({
        where: { supabaseId },
        data: { emailVerified: true },
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== 'P2025') throw err;
      this.logger.debug(
        `email OTP verified, no User row to mirror onto yet (Gate 2 pending) supabaseId=${supabaseId}`,
      );
    }

    return this.toSession(data.session);
  }

  /**
   * Sends a phone OTP via Prelude Verify (server-side; the key never leaves
   * the backend). We store NO code — Prelude owns the OTP lifecycle. Rejects a
   * phone already attached to another user. [supabaseId] comes from the JWT.
   */
  async requestPhoneOtp(supabaseId: string, phone: string): Promise<void> {
    await this.assertPhoneAvailable(supabaseId, phone);
    await this.prelude.sendPhoneOtp(phone);
  }

  /**
   * Verifies the OTP via Prelude. On success, marks the phone verified on our
   * User row (the source of truth) — no new session is issued (the caller is
   * already authenticated). Prelude statuses map to clear French errors.
   */
  async verifyPhoneOtp(
    supabaseId: string,
    phone: string,
    code: string,
  ): Promise<PhoneVerifyResponseDto> {
    const status = await this.prelude.verifyPhoneOtp(phone, code);
    if (status === 'failure') {
      throw new BadRequestException('Code de vérification invalide.');
    }
    if (status !== 'success') {
      // expired_or_not_found / transaction_missing / transaction_mismatch / unknown
      throw new BadRequestException('Code expiré. Veuillez demander un nouveau code.');
    }

    await this.assertPhoneAvailable(supabaseId, phone);
    try {
      await this.prisma.db.user.update({
        where: { supabaseId },
        data: { phone, phoneVerified: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ce numéro de téléphone est déjà utilisé.');
      }
      throw err;
    }
    return { phoneVerified: true, phone };
  }

  /** Rejects a phone already attached to a different user (phone is @unique). */
  private async assertPhoneAvailable(supabaseId: string, phone: string): Promise<void> {
    const taken = await this.prisma.db.user.findFirst({
      where: { phone, NOT: { supabaseId } },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException('Ce numéro de téléphone est déjà utilisé.');
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
    this.logger.error(
      `Supabase auth ${fallback}: ${error.message} (code=${code} status=${status})`,
    );
    return new InternalServerErrorException('Authentication service error');
  }
}
