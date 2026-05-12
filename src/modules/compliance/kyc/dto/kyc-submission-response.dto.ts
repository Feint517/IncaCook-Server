import type { KycSubmission } from '@prisma/client';

import { IdDocumentType } from '@common/enums/id-document-type.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';

export class KycSubmissionResponseDto {
  id!: string;
  idDocumentType!: IdDocumentType;
  idFrontUrl!: string;
  idBackUrl!: string | null;
  selfieUrl!: string;
  drivingLicenseUrl!: string | null;
  carteGriseUrl!: string | null;
  insuranceUrl!: string | null;
  status!: KycStatus;
  rejectionReason!: string | null;
  submittedAt!: Date;
  reviewedAt!: Date | null;

  static from(submission: KycSubmission): KycSubmissionResponseDto {
    return {
      id: submission.id,
      idDocumentType: submission.idDocumentType as IdDocumentType,
      idFrontUrl: submission.idFrontUrl,
      idBackUrl: submission.idBackUrl,
      selfieUrl: submission.selfieUrl,
      drivingLicenseUrl: submission.drivingLicenseUrl,
      carteGriseUrl: submission.carteGriseUrl,
      insuranceUrl: submission.insuranceUrl,
      status: submission.status as KycStatus,
      rejectionReason: submission.rejectionReason,
      submittedAt: submission.submittedAt,
      reviewedAt: submission.reviewedAt,
    };
  }
}
