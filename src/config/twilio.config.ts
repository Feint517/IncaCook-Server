import { registerAs } from '@nestjs/config';

export const twilioConfig = registerAs('twilio', () => ({
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? '',
}));

export type TwilioConfig = ReturnType<typeof twilioConfig>;
