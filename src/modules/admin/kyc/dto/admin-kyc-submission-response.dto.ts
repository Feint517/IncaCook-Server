import type { KycSubmission, User } from '@prisma/client';

import { IdDocumentType } from '@common/enums/id-document-type.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { UserRole } from '@common/enums/user-role.enum';

/**
 * Admin-side view of a KYC submission. The four document URL fields are
 * **signed Storage URLs** (15-minute TTL), not raw object keys — admins
 * need to actually open the documents in their browser.
 *
 * The submitter's identity (name, email, role, business details) is
 * inlined for the review screen so the admin doesn't need a second
 * round-trip.
 */
export class AdminKycSubmissionResponseDto {
  id!: string;
  status!: KycStatus;
  idDocumentType!: IdDocumentType;
  idFrontUrl!: string;
  idBackUrl!: string | null;
  selfieUrl!: string;
  drivingLicenseUrl!: string | null;
  carteGriseUrl!: string | null;
  insuranceUrl!: string | null;
  rejectionReason!: string | null;
  submittedAt!: Date;
  reviewedAt!: Date | null;
  reviewerId!: string | null;

  submitter!: {
    userId: string;
    role: UserRole;
    email: string;
    firstName: string;
    lastName: string;
    /** SIRET shown for traiteur/restaurant sellers; null otherwise. */
    siret?: string | null;
    /** Business name for non-fait-maison sellers; null otherwise. */
    businessName?: string | null;
  };

  static from(
    submission: KycSubmission & {
      user: User & {
        sellerProfile: { siret: string | null; businessName: string | null } | null;
      };
    },
    signed: {
      idFrontUrl: string;
      idBackUrl: string | null;
      selfieUrl: string;
      drivingLicenseUrl: string | null;
      carteGriseUrl: string | null;
      insuranceUrl: string | null;
    },
  ): AdminKycSubmissionResponseDto {
    return {
      id: submission.id,
      status: submission.status as KycStatus,
      idDocumentType: submission.idDocumentType as IdDocumentType,
      idFrontUrl: signed.idFrontUrl,
      idBackUrl: signed.idBackUrl,
      selfieUrl: signed.selfieUrl,
      drivingLicenseUrl: signed.drivingLicenseUrl,
      carteGriseUrl: signed.carteGriseUrl,
      insuranceUrl: signed.insuranceUrl,
      rejectionReason: submission.rejectionReason,
      submittedAt: submission.submittedAt,
      reviewedAt: submission.reviewedAt,
      reviewerId: submission.reviewerId,
      submitter: {
        userId: submission.user.id,
        role: submission.user.role as UserRole,
        email: submission.user.email,
        firstName: submission.user.firstName,
        lastName: submission.user.lastName,
        siret: submission.user.sellerProfile?.siret ?? null,
        businessName: submission.user.sellerProfile?.businessName ?? null,
      },
    };
  }
}

export class AdminKycSubmissionListItemDto {
  id!: string;
  status!: KycStatus;
  idDocumentType!: IdDocumentType;
  submittedAt!: Date;
  reviewedAt!: Date | null;
  submitter!: {
    userId: string;
    role: UserRole;
    email: string;
    firstName: string;
    lastName: string;
  };

  static from(
    submission: KycSubmission & { user: User },
  ): AdminKycSubmissionListItemDto {
    return {
      id: submission.id,
      status: submission.status as KycStatus,
      idDocumentType: submission.idDocumentType as IdDocumentType,
      submittedAt: submission.submittedAt,
      reviewedAt: submission.reviewedAt,
      submitter: {
        userId: submission.user.id,
        role: submission.user.role as UserRole,
        email: submission.user.email,
        firstName: submission.user.firstName,
        lastName: submission.user.lastName,
      },
    };
  }
}

export class AdminKycListResponseDto {
  items!: AdminKycSubmissionListItemDto[];
  limit!: number;
  offset!: number;
  hasMore!: boolean;
}
