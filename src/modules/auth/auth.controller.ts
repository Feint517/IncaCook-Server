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

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { AuthService } from './auth.service';
import { RefreshSessionDto } from './dto/refresh-session.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RequestPhoneOtpDto } from './dto/request-phone-otp.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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

  @Public()
  @Post('password/reset-request')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetRequest(@Body() dto: RequestPasswordResetDto): Promise<void> {
    return this.auth.requestPasswordReset(dto.email, dto.redirectTo);
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
   * Attaches a phone to the caller's existing email-based account and
   * triggers an SMS OTP (or the local test_otp map). Idempotent —
   * calling again with the same phone re-sends; calling with a different
   * phone overwrites the pending one.
   */
  @Post('phone/request-otp')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestPhoneOtp(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: RequestPhoneOtpDto,
  ): Promise<void> {
    const token = extractBearer(authHeader);
    await this.auth.requestPhoneOtp(token, dto.phone);
  }

  /**
   * Confirms the OTP. On success the user's phone is marked verified
   * (both on Supabase and on our User row). Returns a fresh session.
   */
  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  verifyPhoneOtp(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: VerifyPhoneOtpDto,
  ): Promise<SessionResponseDto> {
    const token = extractBearer(authHeader);
    return this.auth.verifyPhoneOtp(token, dto.phone, dto.code);
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
