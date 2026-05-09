import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import twilio, { Twilio } from 'twilio';

import { twilioConfig } from '@config/twilio.config';

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private client?: Twilio;

  constructor(@Inject(twilioConfig.KEY) private readonly cfg: ConfigType<typeof twilioConfig>) {
    if (this.cfg.accountSid && this.cfg.authToken) {
      this.client = twilio(this.cfg.accountSid, this.cfg.authToken);
    } else {
      this.logger.warn('Twilio credentials are not set; SMS notifications disabled.');
    }
  }

  isReady(): boolean {
    return Boolean(this.client);
  }

  async sendSms(_to: string, _body: string): Promise<void> {
    if (!this.client) {
      this.logger.warn('Twilio not initialised; dropping SMS');
      return;
    }
    // Implementation lands with notification dispatchers in a future task.
  }
}
