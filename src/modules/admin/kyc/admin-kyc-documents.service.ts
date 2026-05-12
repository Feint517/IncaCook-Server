import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { KycDocument, User } from '@prisma/client';
import { KycStatus } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';

import { supabaseConfig } from '@config/supabase.config';

import { AuditService } from '@infrastructure/audit/audit.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import { ListAdminKycDocumentsQueryDto } from './dto/list-admin-kyc-documents.query.dto';

/** 15 minutes — long enough for a review session, short enough not to leak. */
const SIGNED_URL_TTL_SECONDS = 15 * 60;

export interface ListResult {
  items: Array<KycDocument & { user: User }>;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface DocumentDetail {
  document: KycDocument & {
    user: User & {
      sellerProfile:
        | { business: { siret: string; businessName: string } | null }
        | null;
    };
  };
  signedFileUrl: string;
}

@Injectable()
export class AdminKycDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseAdminService,
    private readonly audit: AuditService,
    @Inject(supabaseConfig.KEY)
    private readonly cfg: ConfigType<typeof supabaseConfig>,
  ) {}

  async list(query: ListAdminKycDocumentsQueryDto): Promise<ListResult> {
    const reviewState = query.reviewState ?? KycStatus.PENDING;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const rows = await this.prisma.db.kycDocument.findMany({
      where: {
        reviewState,
        ...(query.type ? { type: query.type } : {}),
      },
      include: { user: true },
      // PENDING is FIFO (oldest first); APPROVED/REJECTED reverse-chrono.
      orderBy: {
        submittedAt: reviewState === KycStatus.PENDING ? 'asc' : 'desc',
      },
      take: limit + 1,
      skip: offset,
    });

    const hasMore = rows.length > limit;
    return {
      items: hasMore ? rows.slice(0, limit) : rows,
      limit,
      offset,
      hasMore,
    };
  }

  async findById(id: string): Promise<DocumentDetail> {
    const document = await this.prisma.db.kycDocument.findUnique({
      where: { id },
      include: {
        user: {
          include: {
            sellerProfile: {
              select: { business: { select: { siret: true, businessName: true } } },
            },
          },
        },
      },
    });
    if (!document) {
      throw new NotFoundException('KYC document not found');
    }

    const signedFileUrl = await this.signOrThrow(document.fileUrl);
    return { document, signedFileUrl };
  }

  async approve(documentId: string, reviewerSupabaseId: string): Promise<KycDocument> {
    return this.transitionStatus({
      documentId,
      reviewerSupabaseId,
      newState: KycStatus.APPROVED,
      rejectionReason: null,
      action: 'kyc.approve',
    });
  }

  async reject(
    documentId: string,
    reviewerSupabaseId: string,
    rejectionReason: string,
  ): Promise<KycDocument> {
    return this.transitionStatus({
      documentId,
      reviewerSupabaseId,
      newState: KycStatus.REJECTED,
      rejectionReason,
      action: 'kyc.reject',
    });
  }

  // ---------- internals ----------

  private async transitionStatus(args: {
    documentId: string;
    reviewerSupabaseId: string;
    newState: KycStatus;
    rejectionReason: string | null;
    action: string;
  }): Promise<KycDocument> {
    const reviewer = await this.prisma.db.user.findUnique({
      where: { supabaseId: args.reviewerSupabaseId },
      select: { id: true },
    });
    if (!reviewer) {
      throw new NotFoundException('Reviewer not found');
    }

    const existing = await this.prisma.db.kycDocument.findUnique({
      where: { id: args.documentId },
      include: { user: true },
    });
    if (!existing) {
      throw new NotFoundException('KYC document not found');
    }
    if (existing.reviewState === args.newState) {
      throw new ConflictException(`Document is already ${existing.reviewState}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.kycDocument.update({
        where: { id: args.documentId },
        data: {
          reviewState: args.newState,
          rejectionReason: args.rejectionReason,
          reviewerId: reviewer.id,
          reviewedAt: new Date(),
        },
      });

      // Recompute the user's role-profile kycStatus from the aggregate of
      // their docs: any REJECTED → REJECTED; else any PENDING → PENDING;
      // else (all APPROVED) → APPROVED. Phase C's onboarding endpoint will
      // refine this with "required docs for this role+vehicle" logic; for
      // now, aggregate-of-existing is good enough.
      const states = await tx.kycDocument.groupBy({
        by: ['reviewState'],
        where: { userId: existing.userId },
      });
      const agg = aggregateState(states.map((s) => s.reviewState));

      if (existing.user.role === UserRole.Seller) {
        await tx.sellerProfile.updateMany({
          where: { userId: existing.userId },
          data: { kycStatus: agg },
        });
      } else if (existing.user.role === UserRole.Driver) {
        await tx.driverProfile.updateMany({
          where: { userId: existing.userId },
          data: { kycStatus: agg },
        });
      }

      return doc;
    });

    await this.audit.record({
      actorId: reviewer.id,
      action: args.action,
      targetType: 'KycDocument',
      targetId: updated.id,
      metadata: {
        submitterUserId: existing.userId,
        submitterRole: existing.user.role,
        docType: existing.type,
        rejectionReason: args.rejectionReason,
      },
    });

    return updated;
  }

  /**
   * Signs a Storage object key in the kyc/ bucket. Stored URL fields hold
   * paths *with* the bucket prefix (`kyc/<uid>/...`); strip it before
   * passing to createSignedUrl since the API takes the path within the
   * bucket.
   */
  private async signOrThrow(storedPath: string): Promise<string> {
    const bucket = this.cfg.buckets.kyc;
    const prefix = `${bucket}/`;
    const objectPath = storedPath.startsWith(prefix)
      ? storedPath.slice(prefix.length)
      : storedPath;

    const { data, error } = await this.supabase
      .storage(bucket)
      .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      throw new InternalServerErrorException(
        `Failed to sign KYC document URL: ${error?.message ?? 'unknown error'}`,
      );
    }
    return data.signedUrl;
  }
}

function aggregateState(states: KycStatus[]): KycStatus {
  if (states.includes(KycStatus.REJECTED)) return KycStatus.REJECTED;
  if (states.includes(KycStatus.PENDING)) return KycStatus.PENDING;
  if (states.length === 0) return KycStatus.PENDING; // no docs uploaded yet
  return KycStatus.APPROVED;
}
