import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Where the file is going. Drives both the destination bucket and any
 * role gating (e.g. only sellers can upload to seller-facades). Add new
 * purposes alongside the matching bucket in files.service.
 */
export enum UploadPurpose {
  Avatar = 'avatar',
  KycDocument = 'kyc_document',
  ListingImage = 'listing_image',
  SellerFacade = 'seller_facade',
  DeliveryProof = 'delivery_proof',
}

/**
 * Body for `POST /v1/uploads`. The backend resolves the destination
 * bucket and a unique storage path, then issues a Supabase signed upload
 * URL the client PUTs the file to directly. The client posts the
 * resulting `path` back to the relevant resource endpoint (e.g. PUT
 * /sellers/me/profile with profilePhotoUrl=<path>).
 */
export class CreateUploadUrlDto {
  @IsEnum(UploadPurpose)
  purpose!: UploadPurpose;

  /** Optional MIME hint — informational; the file is whatever the client
   *  actually PUTs to the signed URL. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contentType?: string;
}
