import { IsString, Matches } from 'class-validator';

/**
 * Body for `POST /v1/auth/phone/request-otp`. Authenticated — attaches
 * the phone to the caller's existing email-based account and triggers
 * an SMS OTP. Calling again with a different phone overwrites the
 * pending phone (last-write-wins).
 *
 * Format: E.164 with leading `+` and country code (e.g. `+33611111111`).
 */
export class RequestPhoneOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: "Veuillez saisir un numéro de téléphone valide avec l'indicatif du pays.",
  })
  phone!: string;
}
