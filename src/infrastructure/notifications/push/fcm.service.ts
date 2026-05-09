import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import * as admin from 'firebase-admin';

import { firebaseConfig } from '@config/firebase.config';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app?: admin.app.App;

  constructor(
    @Inject(firebaseConfig.KEY) private readonly cfg: ConfigType<typeof firebaseConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.cfg.projectId || !this.cfg.clientEmail || !this.cfg.privateKey) {
      this.logger.warn('Firebase credentials are not set; push notifications disabled.');
      return;
    }
    if (admin.apps.length > 0) {
      this.app = admin.app();
      return;
    }
    this.app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: this.cfg.projectId,
        clientEmail: this.cfg.clientEmail,
        privateKey: this.cfg.privateKey,
      }),
    });
  }

  isReady(): boolean {
    return Boolean(this.app);
  }

  async sendToToken(_token: string, _payload: admin.messaging.MessagingPayload): Promise<void> {
    if (!this.app) {
      this.logger.warn('FCM not initialised; dropping push notification');
      return;
    }
    // Implementation lands with notification dispatchers in a future task.
  }
}
