import { Transform } from 'class-transformer';
import { IsEmail, IsOptional } from 'class-validator';

/**
 * Body for `POST /v1/auth/email/request-otp`.
 *
 * `email` is OPTIONAL and only used when the authenticated user has no email
 * yet (e.g. a Facebook OAuth identity that returned none): the user enters an
 * address to add + verify. When the JWT already carries an email the body is
 * ignored (the existing email-OTP bypass keeps working unchanged).
 */
export class RequestEmailOtpDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email?: string;
}
