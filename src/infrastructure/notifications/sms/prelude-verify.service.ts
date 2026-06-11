import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { preludeConfig } from '@config/prelude.config';

import type { ConfigType } from '@nestjs/config';

/** Outcome of a Prelude Verify check, normalised for the auth service. */
export type PreludeCheckStatus =
  | 'success'
  | 'failure'
  | 'expired_or_not_found'
  | 'transaction_missing'
  | 'transaction_mismatch'
  | 'unknown';

/**
 * Prelude Verify V2 client (https://docs.prelude.so/verify). Server-side only:
 * the API key never leaves the backend, and OTP codes / provider payloads are
 * NEVER logged. Prelude manages the OTP lifecycle — we store no codes.
 *
 *   - create: POST {baseUrl}/verification   { target: { type, value } }
 *   - check:  POST {baseUrl}/verification/check  { target, code }
 */
@Injectable()
export class PreludeVerifyService {
  private readonly logger = new Logger(PreludeVerifyService.name);

  constructor(
    @Inject(preludeConfig.KEY)
    private readonly cfg: ConfigType<typeof preludeConfig>,
  ) {}

  /** True when an API key is configured (otherwise OTP can't be sent). */
  isReady(): boolean {
    return Boolean(this.cfg.apiKey);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Sends an OTP to [phone] (E.164). Returns Prelude's verification `status`
   * (`success` = dispatched; `blocked`/`shadow_blocked` = refused). Throws on a
   * transport / provider error without leaking the phone or body.
   */
  async sendPhoneOtp(phone: string): Promise<{ status: string; id: string | null }> {
    if (!this.isReady()) {
      throw new ServiceUnavailableException(
        'Service de vérification indisponible. Réessayez plus tard.',
      );
    }
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/verification`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          target: { type: 'phone_number', value: phone },
        }),
      });
    } catch (err) {
      this.logger.error(`Prelude create verification transport error: ${(err as Error).message}`);
      throw new ServiceUnavailableException("L'envoi du code a échoué. Réessayez plus tard.");
    }
    if (!res.ok) {
      // Log status only — never the body (may echo the phone number).
      this.logger.error(`Prelude create verification failed (HTTP ${res.status})`);
      throw new ServiceUnavailableException("L'envoi du code a échoué. Réessayez plus tard.");
    }
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      id?: string;
    };
    return { status: json.status ?? 'unknown', id: json.id ?? null };
  }

  /**
   * Checks [code] for [phone]. Returns the normalised Prelude status — the
   * caller maps it to a user-facing message. Throws only on transport errors.
   */
  async verifyPhoneOtp(phone: string, code: string): Promise<PreludeCheckStatus> {
    if (!this.isReady()) {
      throw new ServiceUnavailableException(
        'Service de vérification indisponible. Réessayez plus tard.',
      );
    }
    let res: Response;
    try {
      res = await fetch(`${this.cfg.baseUrl}/verification/check`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          target: { type: 'phone_number', value: phone },
          code,
        }),
      });
    } catch (err) {
      this.logger.error(`Prelude check verification transport error: ${(err as Error).message}`);
      throw new ServiceUnavailableException('La vérification a échoué. Réessayez plus tard.');
    }
    if (!res.ok) {
      this.logger.error(`Prelude check verification failed (HTTP ${res.status})`);
      throw new ServiceUnavailableException('La vérification a échoué. Réessayez plus tard.');
    }
    const json = (await res.json().catch(() => ({}))) as { status?: string };
    return (json.status as PreludeCheckStatus) ?? 'unknown';
  }
}
