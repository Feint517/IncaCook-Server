import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { KycSubmission, User } from '@prisma/client';

import { KycStatus } from '@common/enums/kyc-status.enum';
import { UserRole } from '@common/enums/user-role.enum';

import { supabaseConfig } from '@config/supabase.config';

import { AuditService } from '@infrastructure/audit/audit.service';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import { ListAdminKycQueryDto } from './dto/list-admin-kyc.query.dto';

/** 15 minutes — long enough for a review session, short enough not to leak. */
const SIGNED_URL_TTL_SECONDS = 15 * 60;

interface SignedUrls {
  idFrontUrl: string;
  idBackUrl: string | null;
  selfieUrl: string;
  drivingLicenseUrl: string | null;
  carteGriseUrl: string | null;
  insuranceUrl: string | null;
}

export interface ListResult {
  items: Array<KycSubmission & { user: User }>;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface SubmissionDetail {
  submission: KycSubmission & {
    user: User & {
      sellerProfile: { siret: string | null; businessName: string | null } | null;
    };
  };
  signed: SignedUrls;
}

@Injectable()
export class AdminKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseAdminService,
    private readonly audit: AuditService,
    @Inject(supabaseConfig.KEY)
    private readonly cfg: ConfigType<typeof supabaseConfig>,
  ) {}

  async list(query: ListAdminKycQueryDto): Promise<ListResult> {
    const status = query.status ?? KycStatus.Pending;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    // Fetch limit+1 for hasMore detection.
    const rows = await this.prisma.db.kycSubmission.findMany({
      where: { status },
      include: { user: true },
      // PENDING queue is FIFO (oldest first); REJECTED/APPROVED are reverse-chrono
      // for normal "what did I review recently" lookups.
      orderBy: {
        submittedAt: status === KycStatus.Pending ? 'asc' : 'desc',
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

  async findById(id: string): Promise<SubmissionDetail> {
    const submission = await this.prisma.db.kycSubmission.findUnique({
      where: { id },
      include: {
        user: {
          include: {
            sellerProfile: { select: { siret: true, businessName: true } },
          },
        },
      },
    });
    if (!submission) {
      throw new NotFoundException('KYC submission not found');
    }

    const signed = await this.signAllDocs(submission);
    return { submission, signed };
  }

  /**
   * Approves the submission. Atomic with the role profile's kycStatus →
   * APPROVED. Writes an AuditLog entry. Idempotent at the status level —
   * approving an already-approved submission is a 409.
   */
  async approve(submissionId: string, reviewerSupabaseId: string): Promise<KycSubmission> {
    const reviewer = await this.prisma.db.user.findUnique({
      where: { supabaseId: reviewerSupabaseId },
      select: { id: true },
    });
    if (!reviewer) {
      throw new NotFoundException('Reviewer not found');
    }

    return this.transitionStatus({
      submissionId,
      reviewerId: reviewer.id,
      newStatus: KycStatus.Approved,
      rejectionReason: null,
      action: 'kyc.approve',
    });
  }

  async reject(
    submissionId: string,
    reviewerSupabaseId: string,
    rejectionReason: string,
  ): Promise<KycSubmission> {
    const reviewer = await this.prisma.db.user.findUnique({
      where: { supabaseId: reviewerSupabaseId },
      select: { id: true },
    });
    if (!reviewer) {
      throw new NotFoundException('Reviewer not found');
    }

    return this.transitionStatus({
      submissionId,
      reviewerId: reviewer.id,
      newStatus: KycStatus.Rejected,
      rejectionReason,
      action: 'kyc.reject',
    });
  }

  // ---------- internals ----------

  private async transitionStatus(args: {
    submissionId: string;
    reviewerId: string;
    newStatus: KycStatus;
    rejectionReason: string | null;
    action: string;
  }): Promise<KycSubmission> {
    const existing = await this.prisma.db.kycSubmission.findUnique({
      where: { id: args.submissionId },
      include: { user: true },
    });
    if (!existing) {
      throw new NotFoundException('KYC submission not found');
    }
    if (existing.status === args.newStatus) {
      throw new ConflictException(`Submission is already ${existing.status}`);
    }

    const submission = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.kycSubmission.update({
        where: { id: args.submissionId },
        data: {
          status: args.newStatus,
          rejectionReason: args.rejectionReason,
          reviewerId: args.reviewerId,
          reviewedAt: new Date(),
        },
      });

      // Mirror the decision onto the role profile so listing-visibility /
      // delivery-assignment gates pick it up.
      if (existing.user.role === UserRole.Seller) {
        await tx.sellerProfile.updateMany({
          where: { userId: existing.user.id },
          data: { kycStatus: args.newStatus },
        });
      } else if (existing.user.role === UserRole.Driver) {
        await tx.driverProfile.updateMany({
          where: { userId: existing.user.id },
          data: { kycStatus: args.newStatus },
        });
      }

      return updated;
    });

    await this.audit.record({
      actorId: args.reviewerId,
      action: args.action,
      targetType: 'KycSubmission',
      targetId: submission.id,
      metadata: {
        submitterUserId: existing.user.id,
        submitterRole: existing.user.role,
        rejectionReason: args.rejectionReason,
      },
    });

    return submission;
  }

  private async signAllDocs(submission: KycSubmission): Promise<SignedUrls> {
    return {
      idFrontUrl: await this.signOrThrow(submission.idFrontUrl),
      idBackUrl: submission.idBackUrl ? await this.signOrThrow(submission.idBackUrl) : null,
      selfieUrl: await this.signOrThrow(submission.selfieUrl),
      drivingLicenseUrl: submission.drivingLicenseUrl
        ? await this.signOrThrow(submission.drivingLicenseUrl)
        : null,
      carteGriseUrl: submission.carteGriseUrl
        ? await this.signOrThrow(submission.carteGriseUrl)
        : null,
      insuranceUrl: submission.insuranceUrl
        ? await this.signOrThrow(submission.insuranceUrl)
        : null,
    };
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
