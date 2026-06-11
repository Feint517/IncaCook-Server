import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { preludeConfig } from '@config/prelude.config';
import { twilioConfig } from '@config/twilio.config';

import { PreludeVerifyService } from './prelude-verify.service';
import { TwilioService } from './twilio.service';

@Module({
  imports: [ConfigModule.forFeature(twilioConfig), ConfigModule.forFeature(preludeConfig)],
  providers: [TwilioService, PreludeVerifyService],
  exports: [TwilioService, PreludeVerifyService],
})
export class SmsModule {}
