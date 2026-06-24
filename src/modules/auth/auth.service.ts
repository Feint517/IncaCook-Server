import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { PreludeVerifyService } from '@infrastructure/notifications/sms/prelude-verify.service';
import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';
import { SupabaseService } from '@infrastructure/supabase/supabase.service';

import { PhoneVerifyResponseDto } from './dto/phone-verify-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';

import type { AuthError, Session, User } from '@supabase/supabase-js';

/** Max time to wait on Supabase signUp before failing fast (incl. its
 *  server-side confirmation-email send). Well under the app's 30s client
 *  timeout so the user gets a clean error instead of a hang. */
const SIGNUP_SUPABASE_TIMEOUT_MS = 12_000;

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
    // Timing logs (NEVER the password) so we can see whether a slow signup is
    // the Supabase call (incl. its confirmation-email send) vs. something else.
    const startedAt = Date.now();
    this.logger.log('signup: request received');

    let result: Awaited<ReturnType<typeof this.anon.client.auth.signUp>>;
    try {
      this.logger.log('signup: supabase.auth.signUp start');
      // Bound the call so a slow Supabase SMTP / upstream can't hang the
      // request for the client's full 30s timeout — fail fast and clean.
      result = await this.withTimeout(
        this.anon.client.auth.signUp({ email, password }),
        SIGNUP_SUPABASE_TIMEOUT_MS,
        'supabase.auth.signUp',
      );
    } catch {
      this.logger.error(
        `signup: supabase.auth.signUp did not return in time (${Date.now() - startedAt}ms)`,
      );
      throw new ServiceUnavailableException(
        "L'inscription a expiré côté serveur. Veuillez réessayer.",
      );
    }
    this.logger.log(`signup: supabase.auth.signUp done (${Date.now() - startedAt}ms)`);

    const { data, error } = result;
    if (error) {
      throw this.toHttpException(error, 'signup failed');
    }
    if (!data.session) {
      // Email confirmation required by Supabase config. We don't return a
      // session here — caller must re-signin once they've confirmed.
      throw new BadRequestException('Account created — confirm your email before signing in');
    }
    const session = this.toSession(data.session);
    this.logger.log(`signup: response sent (${Date.now() - startedAt}ms)`);
    return session;
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
    // The native Google Sign-In iOS SDK embeds a nonce claim in the ID token
    // whose raw value the Flutter plugin never surfaces, so we can't forward a
    // matching nonce here. The Google provider is configured with
    // `skip_nonce_check = true` (see supabase/config.toml + the hosted
    // project's auth settings), which lets `signInWithIdToken` accept the
    // token without nonce validation. `nonce` is therefore optional and only
    // forwarded if a future call site embeds a controllable hashed nonce.
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
   * Sends a 6-digit email verification code via Supabase's email OTP. Pair
   * with `verifyEmailOtp`.
   *
   * When [attach] is true (the OAuth no-email case) we first set the email on
   * the auth user via admin so `signInWithOtp` targets THIS account and the
   * verification binds the address to it. The email stays unconfirmed until
   * the OTP is verified, so the frontend value is never trusted as verified.
   */
  async requestEmailOtp(supabaseId: string, email: string, attach: boolean): Promise<void> {
    // This sends Supabase Auth's email OTP, which is rendered by the
    // "Magic Link" email template. The user sees a 6-DIGIT CODE only if that
    // template renders `{{ .Token }}`; if it renders only
    // `{{ .ConfirmationURL }}` they receive a sign-in LINK instead and the
    // in-app code screen can't proceed. The email is sent by Supabase's own
    // SMTP (Dashboard → Authentication → SMTP Settings), NOT by the backend
    // MAIL_* / nodemailer config — those only drive backend-managed emails.
    // Safe log: no email address, no token.
    this.logger.log(
      'Email OTP requested through Supabase Auth. Make sure Supabase Magic Link template uses {{ .Token }}.',
    );
    if (attach) {
      const { error: updateError } = await this.admin.client.auth.admin.updateUserById(supabaseId, {
        email,
      });
      if (updateError) {
        throw this.toHttpException(updateError, 'email attach failed');
      }
    }
    const { error } = await this.anon.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) {
      throw this.toHttpException(error, 'email OTP request failed');
    }
  }

  /**
   * Attaches `email` (UNCONFIRMED) to the authenticated user via admin, for the
   * Flutter "complete email" magic-link flow. We deliberately don't send the
   * link here: the **client** calls `signInWithOtp(emailRedirectTo: ...)` right
   * after, so the PKCE code-verifier lives in the app and the
   * `incacook://auth/callback?flow=complete_email` redirect can be completed
   * in-app. The email is only ever trusted once the magic link / OTP sets
   * `email_confirmed_at` (the resolver in UsersService checks that). Never logs
   * the address.
   */
  async attachEmail(supabaseId: string, email: string): Promise<void> {
    this.logger.log('Email attach (admin) for the complete-email magic-link flow.');
    const { error } = await this.admin.client.auth.admin.updateUserById(supabaseId, { email });
    if (error) {
      throw this.toHttpException(error, 'email attach failed');
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
    // Confirms the 6-digit code dispatched by `requestEmailOtp`'s
    // `signInWithOtp`. `type: 'email'` matches that flow. The code is only
    // human-visible if the Supabase Magic Link template uses `{{ .Token }}`
    // (see `requestEmailOtp`); a `{{ .ConfirmationURL }}` template sends a
    // link, so the user would never have a code to enter here.
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
   * PUBLIC fallback for a social login (Facebook) whose provider returned no
   * email AND for which no Supabase session was created (the OAuth callback
   * hard-errored). Because there is no session, the JWT-guarded
   * `requestEmailOtp` can't be used — this no-session variant sends a 6-digit
   * email OTP via Supabase, creating the email auth user if needed. Supabase
   * owns the code generation, SMTP delivery, expiry and per-email rate limit;
   * the controller adds an extra request throttle. The email is NOT trusted as
   * verified until [verifySocialEmailOtp] confirms the code. Rejects an email
   * already owned by an existing IncaCook account (no silent account linking).
   * Never logs the address or code.
   */
  async requestSocialEmailOtp(provider: string, email: string): Promise<void> {
    this.assertSupportedSocialProvider(provider);
    await this.assertEmailNotTaken(email);
    this.logger.log('[Auth][Facebook] verification code requested');
    const { error } = await this.anon.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) {
      throw this.toHttpException(error, 'social email OTP request failed');
    }
  }

  /**
   * PUBLIC: confirms the OTP sent by [requestSocialEmailOtp] and returns a
   * fresh session for the now email-verified user. A wrong/expired/reused code
   * fails with a clean French 401. Never logs the code or tokens.
   */
  async verifySocialEmailOtp(
    provider: string,
    email: string,
    code: string,
  ): Promise<SessionResponseDto> {
    this.assertSupportedSocialProvider(provider);
    const { data, error } = await this.anon.client.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    if (error || !data.session) {
      this.logger.warn('[Auth][Facebook] manual email verification failed');
      throw new UnauthorizedException('Code invalide ou expiré.');
    }
    // Best-effort mirror onto our User row (it may not exist yet — created at
    // POST /v1/users during onboarding; Supabase already set email_confirmed_at).
    try {
      await this.prisma.db.user.update({
        where: { supabaseId: data.session.user.id },
        data: { emailVerified: true },
      });
    } catch (err) {
      const errCode = (err as { code?: string } | null)?.code;
      if (errCode !== 'P2025') throw err;
    }
    this.logger.log('[Auth][Facebook] manual email verified');
    return this.toSession(data.session);
  }

  /** Only Facebook needs the no-session email fallback today. */
  private assertSupportedSocialProvider(provider: string): void {
    if (provider !== 'facebook') {
      throw new BadRequestException('Unsupported social provider');
    }
  }

  /**
   * Guards account safety: refuse the social email fallback when the address
   * already belongs to an IncaCook account, so a Facebook attempt can never be
   * silently merged into someone else's account (no automatic linking).
   */
  private async assertEmailNotTaken(email: string): Promise<void> {
    const owner = await this.prisma.db.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (owner) {
      throw new ConflictException('Cette adresse e-mail est déjà utilisée par un autre compte.');
    }
  }

  /**
   * Sends a phone OTP via Prelude Verify (server-side; the key never leaves
   * the backend). We store NO code — Prelude owns the OTP lifecycle. Rejects a
   * phone already attached to another user. [supabaseId] comes from the JWT.
   */
  async requestPhoneOtp(supabaseId: string, phone: string): Promise<void> {
    // Gate FIRST so a phone owned by another account never triggers an SMS:
    // [assertPhoneAvailable] throws PhoneAlreadyUsed (409) and Prelude is not
    // called. This is the same guard the verify path uses (unified handling).
    try {
      await this.assertPhoneAvailable(supabaseId, phone);
    } catch (err) {
      if (err instanceof DomainException && err.code === ErrorCodes.PhoneAlreadyUsed) {
        this.logger.warn(`[PhoneOtp] request failed code=${err.code}`);
      }
      throw err;
    }
    const { status } = await this.prelude.sendPhoneOtp(phone);
    // Prelude statuses: 'success'/'retry' = OTP dispatched; anything else
    // ('blocked', 'shadow_blocked', 'unknown', …) means no SMS was sent — fail
    // loudly instead of advancing the wizard to a code screen that can't work.
    this.logger.log(`Prelude send status=${status}`);
    if (status !== 'success' && status !== 'retry') {
      throw new ServiceUnavailableException(
        "L'envoi du SMS a échoué (numéro non pris en charge ou bloqué). Vérifiez le numéro et réessayez.",
      );
    }
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

    // Persist the verified phone on the Supabase auth user — the source of
    // truth that always exists post-auth. [UsersService.createFromJwt] (Gate 2)
    // mirrors `phone` + `phone_confirmed_at` onto the User row when it's
    // created, so this works whether or not the local row exists yet. The
    // Google / NoProfile path verifies the phone *before* Gate 2, so writing to
    // the (absent) Prisma row here used to 404 with P2025. Supabase stores
    // E.164 without the leading '+'.
    const { error } = await this.admin.client.auth.admin.updateUserById(supabaseId, {
      phone: phone.replace(/^\+/, ''),
      phone_confirm: true,
    });
    if (error) {
      throw this.toHttpException(error, 'phone verification failed');
    }

    // Keep the local row in sync when it already exists (re-verification after
    // Gate 2). `updateMany` is a no-op (count 0) when the row isn't there yet,
    // so the pre-Gate-2 path no longer throws P2025.
    try {
      await this.prisma.db.user.updateMany({
        where: { supabaseId },
        data: { phone, phoneVerified: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DomainException(
          ErrorCodes.PhoneAlreadyUsed,
          'Ce numéro de téléphone est déjà utilisé.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
    return { phoneVerified: true, phone };
  }

  /**
   * Rejects a phone already attached to a different user (phone is @unique).
   * Throws a typed [DomainException] so the response carries the machine
   * code `INCACOOK_PHONE_ALREADY_USED` (409) — the Flutter app keys off it to
   * keep the red error and suppress the "code sent" success message.
   */
  private async assertPhoneAvailable(supabaseId: string, phone: string): Promise<void> {
    const taken = await this.prisma.db.user.findFirst({
      where: { phone, NOT: { supabaseId } },
      select: { id: true },
    });
    if (taken) {
      throw new DomainException(
        ErrorCodes.PhoneAlreadyUsed,
        'Ce numéro de téléphone est déjà utilisé.',
        HttpStatus.CONFLICT,
      );
    }
  }

  // -------------------- internals --------------------

  /** Rejects if `promise` doesn't settle within `ms`. Clears the timer either
   *  way so we don't leak a pending handle. */
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

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
