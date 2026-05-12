import type { KycDocType, KycDocument, KycStatus, User } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';

/**
 * Admin-side detail view of a single KYC document. `fileUrl` is a signed
 * Storage URL (15-minute TTL), not the raw object key — admins open it in
 * a browser. The submitter's identity is inlined for context so the review
 * screen doesn't need a second round-trip.
 */
export class AdminKycDocumentResponseDto {
  id!: string;
  type!: KycDocType;
  reviewState!: KycStatus;
  fileUrl!: string;
  rejectionReason!: string | null;
  submittedAt!: Date;
  reviewedAt!: Date | null;
  reviewerId!: string | null;
  metadata!: Record<string, unknown> | null;

  submitter!: {
    userId: string;
    role: UserRole;
    email: string;
    firstName: string;
    lastName: string;
    /** SIRET shown for traiteur/restaurant sellers; null for fait-maison or driver. */
    siret?: string | null;
    /** Business name for non-fait-maison sellers; null otherwise. */
    businessName?: string | null;
  };

  static from(
    doc: KycDocument & {
      user: User & {
        sellerProfile:
          | { business: { siret: string; businessName: string } | null }
          | null;
      };
    },
    signedFileUrl: string,
  ): AdminKycDocumentResponseDto {
    return {
      id: doc.id,
      type: doc.type,
      reviewState: doc.reviewState,
      fileUrl: signedFileUrl,
      rejectionReason: doc.rejectionReason,
      submittedAt: doc.submittedAt,
      reviewedAt: doc.reviewedAt,
      reviewerId: doc.reviewerId,
      metadata: (doc.metadata as Record<string, unknown> | null) ?? null,
      submitter: {
        userId: doc.user.id,
        role: doc.user.role as UserRole,
        email: doc.user.email,
        firstName: doc.user.firstName,
        lastName: doc.user.lastName,
        siret: doc.user.sellerProfile?.business?.siret ?? null,
        businessName: doc.user.sellerProfile?.business?.businessName ?? null,
      },
    };
  }
}

export class AdminKycDocumentListItemDto {
  id!: string;
  type!: KycDocType;
  reviewState!: KycStatus;
  submittedAt!: Date;
  reviewedAt!: Date | null;
  submitter!: {
    userId: string;
    role: UserRole;
    email: string;
    firstName: string;
    lastName: string;
  };

  static from(doc: KycDocument & { user: User }): AdminKycDocumentListItemDto {
    return {
      id: doc.id,
      type: doc.type,
      reviewState: doc.reviewState,
      submittedAt: doc.submittedAt,
      reviewedAt: doc.reviewedAt,
      submitter: {
        userId: doc.user.id,
        role: doc.user.role as UserRole,
        email: doc.user.email,
        firstName: doc.user.firstName,
        lastName: doc.user.lastName,
      },
    };
  }
}

export class AdminKycDocumentListResponseDto {
  items!: AdminKycDocumentListItemDto[];
  limit!: number;
  offset!: number;
  hasMore!: boolean;
}
