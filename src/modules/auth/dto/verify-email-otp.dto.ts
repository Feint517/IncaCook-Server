import { IsString, Matches } from 'class-validator';

/**
 * Body for `POST /v1/auth/email/verify`. Confirms the 6-digit code sent to
 * the caller's email by `/v1/auth/email/request-otp`. Temporary substitute
 * for the SMS OTP flow while the phone provider is unavailable; on success
 * we flip `User.phoneVerified = true` so downstream gates pass.
 */
export class VerifyEmailOtpDto {
  @IsString()
  // Supabase's OTP length is a per-project setting (currently 6-10 digits;
  // 6 on local CLI, 8 by default on cloud). Match the same range as the
  // phone OTP DTO so future config changes don't require a redeploy.
  @Matches(/^\d{6,10}$/, { message: 'code must be 6-10 digits' })
  code!: string;
}
