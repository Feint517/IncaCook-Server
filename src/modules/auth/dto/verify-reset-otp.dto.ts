import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Body for `POST /v1/auth/password/verify-reset-otp`. Confirms the 6-digit
 * recovery code emailed by `/v1/auth/password/reset-request`. On success the
 * caller receives a recovery session whose access token authorizes
 * `/v1/auth/password/update`.
 */
export class VerifyResetOtpDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  // Mirrors the email/phone OTP DTOs: Supabase OTP length is a per-project
  // setting (6 on local CLI, up to 10 on cloud).
  @Matches(/^\d{6,10}$/, { message: 'code must be 6-10 digits' })
  code!: string;
}
