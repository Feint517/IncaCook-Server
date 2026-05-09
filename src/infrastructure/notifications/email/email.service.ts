import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private client?: Resend;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.from = this.config.get<string>('EMAIL_FROM', 'noreply@incacook.com');
    if (apiKey) {
      this.client = new Resend(apiKey);
    } else {
      this.logger.warn('Resend API key not set; email notifications disabled.');
    }
  }

  isReady(): boolean {
    return Boolean(this.client);
  }

  async send(_to: string | string[], _subject: string, _html: string): Promise<void> {
    if (!this.client) {
      this.logger.warn(`Email client not initialised; dropping message from ${this.from}`);
      return;
    }
    // Implementation lands with notification dispatchers in a future task.
  }
}
