import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `POST /v1/admin/kyc-submissions/:id/reject`. */
export class RejectKycSubmissionDto {
  /** User-facing reason (the seller/driver sees this in the app). */
  @IsString() @MinLength(3) @MaxLength(500)
  rejectionReason!: string;
}
