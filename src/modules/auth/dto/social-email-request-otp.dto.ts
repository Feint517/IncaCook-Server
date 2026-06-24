import { Transform } from 'class-transformer';
import { IsEmail, IsIn } from 'class-validator';

/**
 * Body for the PUBLIC `POST /v1/auth/social/email/request-otp`.
 *
 * Used when a social login (currently Facebook) returns NO email and NO
 * Supabase session was created, so the JWT-guarded `/auth/email/*` endpoints
 * can't be reached. The user enters an email; the backend sends a 6-digit OTP
 * via Supabase (SMTP / expiry / rate-limit owned by Supabase), creating the
 * email auth user if needed. The email is never trusted until the OTP is
 * verified.
 */
export class SocialEmailRequestOtpDto {
  @IsIn(['facebook'])
  provider!: 'facebook';

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;
}
