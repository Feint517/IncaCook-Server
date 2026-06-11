import { IsString, Matches } from 'class-validator';

/**
 * Body for `POST /v1/auth/phone/verify`. Confirms the OTP that was sent via
 * request-otp (Prelude Verify); on success we set User.phone / phoneVerified.
 */
export class VerifyPhoneOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: "Veuillez saisir un numéro de téléphone valide avec l'indicatif du pays.",
  })
  phone!: string;

  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'code must be 4-8 digits' })
  code!: string;
}
