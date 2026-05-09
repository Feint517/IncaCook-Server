import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { twilioConfig } from '@config/twilio.config';

import { TwilioService } from './twilio.service';

@Module({
  imports: [ConfigModule.forFeature(twilioConfig)],
  providers: [TwilioService],
  exports: [TwilioService],
})
export class SmsModule {}
