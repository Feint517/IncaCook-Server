import type { KycDocument, KycDocType, KycStatus } from '@prisma/client';

export class KycDocumentResponseDto {
  id!: string;
  type!: KycDocType;
  fileUrl!: string;
  reviewState!: KycStatus;
  rejectionReason!: string | null;
  submittedAt!: Date;
  reviewedAt!: Date | null;
  /** Per-slot metadata stashed at upload time (e.g. `idDocumentType` on ID_FRONT). */
  metadata!: Record<string, unknown> | null;

  static from(doc: KycDocument): KycDocumentResponseDto {
    return {
      id: doc.id,
      type: doc.type,
      fileUrl: doc.fileUrl,
      reviewState: doc.reviewState,
      rejectionReason: doc.rejectionReason,
      submittedAt: doc.submittedAt,
      reviewedAt: doc.reviewedAt,
      metadata: (doc.metadata as Record<string, unknown> | null) ?? null,
    };
  }
}
