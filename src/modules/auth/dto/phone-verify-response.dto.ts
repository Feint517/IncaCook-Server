/**
 * Response for `POST /v1/auth/phone/verify`. Prelude verifies the OTP, so no
 * new auth session is issued (the caller is already authenticated) — we just
 * confirm the phone is now verified on our User row.
 */
export class PhoneVerifyResponseDto {
  phoneVerified!: boolean;
  phone!: string;
}
