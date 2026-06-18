import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CharterKind, LegalDocument } from '@prisma/client';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { NotificationsService } from '@modules/notifications/notifications.service';

import { CreateLegalDocumentDto } from './dto/create-legal-document.dto';
import { UpdateLegalDocumentDto } from './dto/update-legal-document.dto';

/** Only CGU/CGV are managed by this feature (CharterKind has more values). */
const LEGAL_KINDS: CharterKind[] = [CharterKind.CGU, CharterKind.CGV];

/** FCM copy sent to every user when a new CGU/CGV version is published. */
const LEGAL_UPDATE_NOTIFICATION = {
  title: 'CGU/CGV mises à jour',
  body: 'Les conditions d’utilisation ont été mises à jour. Merci de les consulter.',
} as const;

/** API shape of a legal document (mirrors the row; no hidden fields). */
export interface LegalDocumentView {
  id: string;
  kind: CharterKind;
  version: string;
  title: string;
  content: string;
  isActive: boolean;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class LegalDocumentsService {
  private readonly logger = new Logger(LegalDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** All CGU/CGV documents (admin view), grouped by kind, newest first. */
  async list(): Promise<LegalDocumentView[]> {
    const docs = await this.prisma.db.legalDocument.findMany({
      where: { kind: { in: LEGAL_KINDS } },
      orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
    });
    return docs.map(toView);
  }

  /** The currently-active CGU + CGV documents (≤ 1 per kind). Used by the
   *  public mobile endpoint and the admin "active" view. */
  async activeAll(): Promise<LegalDocumentView[]> {
    const docs = await this.prisma.db.legalDocument.findMany({
      where: { kind: { in: LEGAL_KINDS }, isActive: true },
      orderBy: { kind: 'asc' },
    });
    return docs.map(toView);
  }

  /** Creates a draft (inactive) document. Rejects a duplicate (kind, version). */
  async create(dto: CreateLegalDocumentDto, adminSupabaseId: string): Promise<LegalDocumentView> {
    const existing = await this.prisma.db.legalDocument.findUnique({
      where: { kind_version: { kind: dto.kind, version: dto.version } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Un document ${dto.kind} en version ${dto.version} existe déjà.`);
    }
    const adminId = await this.resolveLocalUserId(adminSupabaseId);
    const doc = await this.prisma.db.legalDocument.create({
      data: {
        id: generateUlid(),
        kind: dto.kind,
        version: dto.version,
        title: dto.title,
        content: dto.content,
        isActive: false,
        createdBy: adminId,
        updatedBy: adminId,
      },
    });
    return toView(doc);
  }

  /** Edits version/title/content of an existing document (kind is immutable). */
  async update(
    id: string,
    dto: UpdateLegalDocumentDto,
    adminSupabaseId: string,
  ): Promise<LegalDocumentView> {
    const current = await this.getOrThrow(id);
    if (dto.version && dto.version !== current.version) {
      const clash = await this.prisma.db.legalDocument.findUnique({
        where: { kind_version: { kind: current.kind, version: dto.version } },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException(
          `Un document ${current.kind} en version ${dto.version} existe déjà.`,
        );
      }
    }
    const adminId = await this.resolveLocalUserId(adminSupabaseId);
    const doc = await this.prisma.db.legalDocument.update({
      where: { id },
      data: {
        ...(dto.version !== undefined ? { version: dto.version } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        updatedBy: adminId,
      },
    });
    return toView(doc);
  }

  /**
   * Publishes a document: marks it active, deactivates any other active version
   * of the same kind (one active per kind), stamps publishedAt, then notifies
   * every user via FCM. The notification is best-effort and never blocks the
   * publish.
   */
  async publish(id: string, adminSupabaseId: string): Promise<LegalDocumentView> {
    const target = await this.getOrThrow(id);
    const adminId = await this.resolveLocalUserId(adminSupabaseId);

    const published = await this.prisma.$transaction(async (tx) => {
      await tx.legalDocument.updateMany({
        where: { kind: target.kind, isActive: true, NOT: { id } },
        data: { isActive: false },
      });
      return tx.legalDocument.update({
        where: { id },
        data: {
          isActive: true,
          publishedAt: target.publishedAt ?? new Date(),
          updatedBy: adminId,
        },
      });
    });

    // Notify all users — never let a push failure break publishing.
    await this.notifyUsersOfUpdate(published.kind, published.version);

    this.logger.log(
      `[legal] published ${published.kind} ${published.version} (id=${published.id})`,
    );
    return toView(published);
  }

  /** Fans the "terms updated" push out to every user. Self-contained: any
   *  failure is logged and swallowed so publishing always succeeds. */
  private async notifyUsersOfUpdate(kind: CharterKind, version: string): Promise<void> {
    try {
      const users = await this.prisma.db.user.findMany({ select: { id: true } });
      const userIds = users.map((u) => u.id);
      if (userIds.length === 0) return;
      const counts = await this.notifications.sendToUsers(userIds, {
        title: LEGAL_UPDATE_NOTIFICATION.title,
        body: LEGAL_UPDATE_NOTIFICATION.body,
        data: { type: 'legal_terms_updated', kind, version },
      });
      this.logger.log(
        `[legal] update push for ${kind} ${version}: users=${userIds.length} ` +
          `sent=${counts.sent} failed=${counts.failed}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[legal] update push failed for ${kind} ${version}: ${reason}`);
    }
  }

  private async getOrThrow(id: string): Promise<LegalDocument> {
    const doc = await this.prisma.db.legalDocument.findUnique({ where: { id } });
    if (!doc || !LEGAL_KINDS.includes(doc.kind)) {
      throw new NotFoundException('Document légal introuvable.');
    }
    return doc;
  }

  /** Maps the admin's Supabase id to the local User.id for the audit columns. */
  private async resolveLocalUserId(supabaseId: string): Promise<string | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    return user?.id ?? null;
  }
}

function toView(doc: LegalDocument): LegalDocumentView {
  return {
    id: doc.id,
    kind: doc.kind,
    version: doc.version,
    title: doc.title,
    content: doc.content,
    isActive: doc.isActive,
    publishedAt: doc.publishedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
