import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

/**
 * Body for `POST /v1/auth/email/verify`. Confirms the 6-digit code sent to
 * the caller's email by `/v1/auth/email/request-otp`; on success we flip
 * `User.emailVerified = true`.
 *
 * `email` is OPTIONAL and only used for the add-email flow (OAuth identity
 * with no email) — must match the address `request-otp` sent the code to.
 * Ignored when the JWT already carries an email.
 */

export class VerifyEmailOtpDto {
  @IsString()
  @Length(6, 6)
  code!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email?: string;
}
