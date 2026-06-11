import { Injectable, NotFoundException } from '@nestjs/common';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { CreateCatalogProductDto, UpdateCatalogProductDto } from './dto/catalog-product.dto';

/**
 * Admin-side catalog: products created by admins and sold to sellers.
 * All routes that reach here are guarded by `@Roles(ADMIN, MODERATOR)`.
 */
@Injectable()
export class CatalogAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async create(adminId: string, dto: CreateCatalogProductDto) {
    return this.prisma.db.catalogProduct.create({
      data: {
        id: generateUlid(),
        name: dto.name,
        description: dto.description ?? null,
        imageUrls: dto.imageUrls ?? [],
        priceCents: dto.priceCents,
        currency: (dto.currency ?? 'usd').toLowerCase(),
        isActive: dto.isActive ?? true,
        createdById: adminId,
      },
    });
  }

  /** All non-deleted products (incl. inactive), newest first. */
  async list() {
    return this.prisma.db.catalogProduct.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const product = await this.prisma.db.catalogProduct.findUnique({
      where: { id },
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async update(id: string, dto: UpdateCatalogProductDto) {
    await this.get(id); // 404 if missing/deleted
    return this.prisma.db.catalogProduct.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
        ...(dto.imageUrls !== undefined ? { imageUrls: dto.imageUrls } : {}),
        ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency.toLowerCase() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  /** Soft delete — keeps order history intact (snapshots on order items). */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.db.catalogProduct.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /** All catalog purchases (newest first) for the admin orders view. */
  async listOrders() {
    return this.prisma.db.catalogOrder.findMany({
      include: {
        items: true,
        seller: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
