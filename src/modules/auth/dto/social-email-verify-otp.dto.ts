import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length } from 'class-validator';

/**
 * Body for the PUBLIC `POST /v1/auth/social/email/verify-otp`. Confirms the
 * 6-digit code sent by `/auth/social/email/request-otp` and returns a fresh
 * session for the (now email-verified) user.
 */
export class SocialEmailVerifyOtpDto {
  @IsIn(['facebook'])
  provider!: 'facebook';

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
