import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string | number;
  metadata?: Record<string, unknown>;
}

/**
 * Persistent audit record. Used for actions that must survive in the DB
 * for compliance / forensics — admin reviews, status changes, GDPR
 * erasures, etc.
 */
export interface AuditRecord {
  /** User.id of the actor. Null for system-initiated actions. */
  actorId: string | null;
  /** e.g. "kyc.approve", "kyc.reject", "user.suspend". Stable, not localised. */
  action: string;
  /** Type of the affected resource. e.g. "KycSubmission", "Listing". */
  targetType?: string;
  /** PK of the affected resource. */
  targetId?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lightweight structured log. Use for transient events that don't need
   * to survive in the DB.
   */
  async log(entry: AuditEntry): Promise<void> {
    this.logger.log({
      msg: 'audit',
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      metadata: entry.metadata,
    });
  }

  /**
   * Persistent audit row in the AuditLog table. Use for compliance-grade
   * events: KYC approvals/rejections, user suspensions, admin overrides.
   * Also emits the structured log entry for ops visibility.
   */
  async record(record: AuditRecord): Promise<void> {
    await this.prisma.db.auditLog.create({
      data: {
        id: generateUlid(),
        actorId: record.actorId,
        action: record.action,
        targetType: record.targetType ?? null,
        targetId: record.targetId ?? null,
        metadata:
          record.metadata !== undefined
            ? (record.metadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        correlationId: record.correlationId ?? null,
        ipAddress: record.ipAddress ?? null,
      },
    });

    this.logger.log({
      msg: 'audit.record',
      actor: record.actorId,
      action: record.action,
      target: `${record.targetType ?? ''}:${record.targetId ?? ''}`,
      metadata: record.metadata,
    });
  }
}
