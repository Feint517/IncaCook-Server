import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { toUserResponse } from '@modules/users/users.controller';
import { UsersService } from '@modules/users/users.service';

import { AuthService } from './auth.service';
import { GoogleSignInDto } from './dto/google-sign-in.dto';
import { OAuthSyncResponseDto } from './dto/oauth-sync-response.dto';
import { PhoneVerifyResponseDto } from './dto/phone-verify-response.dto';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { RequestEmailOtpDto } from './dto/request-email-otp.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RequestPhoneOtpDto } from './dto/request-phone-otp.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  /** Create a new auth identity. Profile + role come later via POST /v1/users. */
  @Public()
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  signUp(@Body() dto: SignUpDto): Promise<SessionResponseDto> {
    return this.auth.signUp(dto.email, dto.password);
  }

  @Public()
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  signIn(@Body() dto: SignInDto): Promise<SessionResponseDto> {
    return this.auth.signIn(dto.email, dto.password);
  }

  /**
   * Mobile-native Google Sign-In. App POSTs the Google ID token (from
   * the `google_sign_in` plugin) and receives the same `SessionResponse`
   * shape as email signup. On a first-time Google user the wizard must
   * still POST `/v1/users` afterwards (Gate 2) — Google gives us the
   * identity, not the role.
   */
  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  google(@Body() dto: GoogleSignInDto): Promise<SessionResponseDto> {
    return this.auth.signInWithGoogle(dto.idToken, dto.nonce);
  }

  /**
   * Provider-agnostic post-OAuth sync. Used after a hosted-OAuth login
   * (Facebook via Supabase, in the Flutter app) where the session is minted
   * client-side: the app sends the Supabase JWT as Bearer and we report
   * whether an IncaCook profile already exists for that identity.
   *
   * **Not** `@Public` — the global JwtAuthGuard validates the Supabase JWT,
   * and `@CurrentUser()` gives us the `sub` (id) + email. We never create an
   * incomplete row here (role/name/CGU come from onboarding); a first-time
   * user gets `hasProfile: false` and continues the wizard. Throws 409 if a
   * different identity already owns the email (duplicate-email guard).
   */
  @Post('oauth/sync')
  @HttpCode(HttpStatus.OK)
  async oauthSync(@CurrentUser() jwtUser: AuthenticatedUser): Promise<OAuthSyncResponseDto> {
    const { hasProfile, aggregate, email, needsEmail } = await this.users.syncFromJwt({
      supabaseId: jwtUser.id,
      email: jwtUser.email,
      phone: jwtUser.phone,
    });
    return {
      profileExists: hasProfile,
      needsEmail,
      email,
      user: aggregate ? toUserResponse(aggregate) : null,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshSessionDto): Promise<SessionResponseDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  /**
   * Revokes the current session. `?scope=global` revokes every session for
   * the user; the default `local` only revokes this device.
   */
  @Post('signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(
    @Headers('authorization') authHeader: string | undefined,
    @Query('scope') scope: string | undefined,
  ): Promise<void> {
    const token = extractBearer(authHeader);
    const resolvedScope = scope === 'global' ? 'global' : 'local';
    await this.auth.signOut(token, resolvedScope);
  }

  /**
   * Starts the forgot-password flow. If the email belongs to a real account,
   * Supabase emails a 6-digit recovery code (no link — see the recovery email
   * template using `{{ .Token }}`). The response is intentionally generic so
   * it never reveals whether the email is registered.
   */
  @Public()
  @Post('password/reset-request')
  @HttpCode(HttpStatus.OK)
  async resetRequest(@Body() dto: RequestPasswordResetDto): Promise<{ message: string }> {
    await this.auth.requestPasswordReset(dto.email, dto.redirectTo);
    return { message: 'If this email exists, a reset code has been sent.' };
  }

  /**
   * Confirms the 6-digit reset code from the forgot-password email and returns
   * a recovery session. The app then calls `password/update` with the returned
   * `accessToken` as Bearer to set the new password.
   */
  @Public()
  @Post('password/verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  verifyResetOtp(@Body() dto: VerifyResetOtpDto): Promise<SessionResponseDto> {
    return this.auth.verifyPasswordResetOtp(dto.email, dto.code);
  }

  /**
   * Sets a new password. The Bearer is either:
   *   - the user's normal session (changing password while signed in), or
   *   - the recovery JWT delivered by the password-reset email link.
   * The strategy doesn't distinguish — both verify the same way.
   */
  @Post('password/update')
  @HttpCode(HttpStatus.NO_CONTENT)
  updatePassword(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: UpdatePasswordDto,
  ): Promise<void> {
    return this.auth.updatePassword(jwtUser.id, dto.newPassword);
  }

  /**
   * Sends a 6-digit verification code to the caller's email.
   *   - JWT already has an email → send to it (existing email-OTP bypass).
   *   - JWT has none (e.g. Facebook returned no email) → use the body `email`:
   *     attach it (unconfirmed) to this auth user, then send the OTP so the
   *     code binds to THIS account. Pair with POST /v1/auth/email/verify.
   */
  @Post('email/request-otp')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestEmailOtp(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: RequestEmailOtpDto,
  ): Promise<void> {
    const jwtEmail = typeof jwtUser.email === 'string' ? jwtUser.email.trim() : '';
    const bodyEmail = typeof dto.email === 'string' ? dto.email.trim() : '';

    const email = jwtEmail || bodyEmail;

    if (!email) {
      throw new BadRequestException('Email is required');
    }

    await this.auth.requestEmailOtp(jwtUser.id, email, /* attach */ !jwtEmail);
  }

  /**
   * Attaches an email (unconfirmed) to the authenticated OAuth user (Facebook
   * no-email case) via admin, so the Flutter client can then send a Supabase
   * magic link itself (`signInWithOtp` with `emailRedirectTo`) — keeping the
   * PKCE verifier in the app so `incacook://auth/callback?flow=complete_email`
   * completes in-app. The email is only trusted once the link/OTP confirms it.
   */
  @Post('email/attach')
  @HttpCode(HttpStatus.NO_CONTENT)
  async attachEmail(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: RequestEmailOtpDto,
  ): Promise<void> {
    const email = typeof dto.email === 'string' ? dto.email.trim() : '';
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    await this.auth.attachEmail(jwtUser.id, email);
  }

  /**
   * Confirms the email OTP. On success the email is verified on the Supabase
   * user (so subsequent `POST /v1/users` resolves it) and `User.emailVerified`
   * is set; returns a fresh session minted by Supabase.
   */
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmailOtp(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: VerifyEmailOtpDto,
  ): Promise<SessionResponseDto> {
    const jwtEmail = typeof jwtUser.email === 'string' ? jwtUser.email.trim() : '';
    const bodyEmail = typeof dto.email === 'string' ? dto.email.trim() : '';

    const email = jwtEmail || bodyEmail;

    if (!email) {
      throw new BadRequestException('Email is required');
    }

    return this.auth.verifyEmailOtp(jwtUser.id, email, dto.code);
  }

  /**
   * Attaches a phone to the caller's account and sends an OTP via Prelude
   * Verify. Idempotent — re-calling re-sends. Rate-limited to curb SMS abuse.
   */
  @Post('phone/request-otp')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestPhoneOtp(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: RequestPhoneOtpDto,
  ): Promise<void> {
    await this.auth.requestPhoneOtp(jwtUser.id, dto.phone);
  }

  /**
   * Confirms the OTP via Prelude. On success the user's phone is marked
   * verified on our User row (no new session — the caller is already authed).
   * Verify attempts are rate-limited.
   */
  @Post('phone/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  verifyPhoneOtp(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: VerifyPhoneOtpDto,
  ): Promise<PhoneVerifyResponseDto> {
    return this.auth.verifyPhoneOtp(jwtUser.id, dto.phone, dto.code);
  }
}

function extractBearer(header: string | undefined): string {
  if (!header) {
    throw new BadRequestException('Missing Authorization header');
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new BadRequestException('Authorization header must be Bearer <token>');
  }
  return token;
}
