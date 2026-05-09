import { Injectable, Logger } from '@nestjs/common';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string | number;
  metadata?: Record<string, unknown>;
}

/**
 * Centralised audit logger. Writes structured events to the application
 * logger today; will persist to an `audit_logs` table once Prisma models
 * are introduced.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  async log(entry: AuditEntry): Promise<void> {
    this.logger.log({
      msg: 'audit',
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      metadata: entry.metadata,
    });
  }
}
