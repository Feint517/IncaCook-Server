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

  async sendToToken(token: string, payload: admin.messaging.MessagingPayload): Promise<void> {
    if (!this.app) {
      this.logger.warn('FCM not initialised; dropping push notification');
      return;
    }
    try {
      await admin.messaging(this.app).send({
        token,
        notification: payload.notification
          ? {
              title: payload.notification.title,
              body: payload.notification.body,
            }
          : undefined,
        data: payload.data,
      });
    } catch (err) {
      // A single dead/unregistered token must not break the caller's loop.
      // Cleanup of stale tokens lands with the dispatchers in a later task.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`FCM send failed for token ${token.slice(0, 12)}…: ${reason}`);
    }
  }

  /**
   * Like [sendToToken] but reports the outcome so bulk callers can count
   * delivered/failed and prune dead tokens. `invalidToken` is true when
   * Firebase says the token is unregistered/invalid (safe to delete).
   */
  async sendToTokenWithResult(
    token: string,
    payload: admin.messaging.MessagingPayload,
  ): Promise<{ delivered: boolean; invalidToken: boolean }> {
    if (!this.app) {
      return { delivered: false, invalidToken: false };
    }
    try {
      await admin.messaging(this.app).send({
        token,
        notification: payload.notification
          ? { title: payload.notification.title, body: payload.notification.body }
          : undefined,
        data: payload.data,
      });
      return { delivered: true, invalidToken: false };
    } catch (err) {
      const code =
        (err as { errorInfo?: { code?: string }; code?: string }).errorInfo?.code ??
        (err as { code?: string }).code ??
        '';
      const invalidToken =
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument';
      return { delivered: false, invalidToken };
    }
  }
}
