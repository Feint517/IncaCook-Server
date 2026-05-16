import { IsString, Matches } from 'class-validator';

/**
 * Body for `POST /v1/auth/email/verify`. Confirms the 6-digit code sent to
 * the caller's email by `/v1/auth/email/request-otp`. Temporary substitute
 * for the SMS OTP flow while the phone provider is unavailable; on success
 * we flip `User.phoneVerified = true` so downstream gates pass.
 */
export class VerifyEmailOtpDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}
