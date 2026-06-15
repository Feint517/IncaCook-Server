import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
} from 'class-validator';

import type { CatalogProduct } from '@prisma/client';

/** Admin creates a catalog product (sold to sellers). */
export class CreateCatalogProductDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUrl({}, { each: true, message: 'Chaque image doit être une URL valide (https://…).' })
  imageUrls?: string[];

  @IsInt()
  @Min(1)
  priceCents!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Admin edits a product. All fields optional. */
export class UpdateCatalogProductDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsUrl({}, { each: true, message: 'Chaque image doit être une URL valide (https://…).' })
  imageUrls?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  priceCents?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Product as returned to admins (full) and sellers (active only). */
export class CatalogProductResponseDto {
  id!: string;
  name!: string;
  description!: string | null;
  imageUrls!: string[];
  priceCents!: number;
  currency!: string;
  isActive!: boolean;
  createdAt!: string;
  updatedAt!: string;

  static from(p: CatalogProduct): CatalogProductResponseDto {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      imageUrls: p.imageUrls,
      priceCents: p.priceCents,
      currency: p.currency,
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
