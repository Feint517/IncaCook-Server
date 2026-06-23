import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import type { CatalogClaim } from '@prisma/client';

export type CatalogClaimType = 'NEVER_RECEIVED' | 'DEFECTIVE' | 'WRONG_ITEM';
export type CatalogClaimStatus =
  | 'OPEN'
  | 'ADMIN_REVIEW'
  | 'REFUNDED'
  | 'REPLACEMENT_REQUESTED'
  | 'REJECTED'
  | 'RESOLVED';

export const CATALOG_CLAIM_TYPES: CatalogClaimType[] = [
  'NEVER_RECEIVED',
  'DEFECTIVE',
  'WRONG_ITEM',
];

/** Body for `POST /v1/catalog/orders/:orderId/claims` — a seller SAV claim. */
export class CreateCatalogClaimDto {
  @IsIn(CATALOG_CLAIM_TYPES)
  type!: CatalogClaimType;

  @IsString()
  @MaxLength(2000)
  description!: string;

  /** Storage paths of problem photos (resolve via publicImageUrl client-side). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  photoUrls?: string[];
}

/** Admin refund action — optional partial amount (defaults to the order total). */
export class CatalogClaimRefundDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  refundAmountCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Admin replacement / reject / resolve action. */
export class CatalogClaimActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  replacementNotes?: string;
}

export class CatalogClaimResponseDto {
  id!: string;
  catalogOrderId!: string;
  sellerId!: string;
  type!: string;
  status!: string;
  description!: string;
  photoUrls!: string[];
  adminNotes!: string | null;
  refundAmountCents!: number | null;
  replacementNotes!: string | null;
  createdAt!: string;
  updatedAt!: string;
  resolvedAt!: string | null;

  static from(c: CatalogClaim): CatalogClaimResponseDto {
    return {
      id: c.id,
      catalogOrderId: c.catalogOrderId,
      sellerId: c.sellerId,
      type: c.type,
      status: c.status,
      description: c.description,
      photoUrls: Array.isArray(c.photoUrls) ? (c.photoUrls as string[]) : [],
      adminNotes: c.adminNotes,
      refundAmountCents: c.refundAmountCents,
      replacementNotes: c.replacementNotes,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      resolvedAt: c.resolvedAt?.toISOString() ?? null,
    };
  }
}
