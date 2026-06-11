import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `POST /v1/admin/kyc/documents/:id/reject`. */
export class RejectKycDocumentDto {
  /** User-facing reason (the seller/driver sees this in the app). */
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  rejectionReason!: string;
}
