import { IsString, Matches } from 'class-validator';

/**
 * Body for `POST /v1/auth/phone/verify`. Confirms the OTP that was sent
 * via request-otp; on success Supabase marks the phone as confirmed and
 * we mirror onto User.phone / User.phoneVerified.
 */
export class VerifyPhoneOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phone must be E.164 (e.g. +33611111111)',
  })
  phone!: string;

  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'code must be 4-8 digits' })
  code!: string;
}
