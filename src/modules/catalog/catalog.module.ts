import { Module } from '@nestjs/common';

import { AdminCatalogController } from './admin-catalog.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

/**
 * Admin product catalog sold to sellers. `PrismaService` + `StripeService`
 * are global, so no imports are needed. Admin CRUD ({@link
 * AdminCatalogController}) is ADMIN-only; the seller browse/purchase surface
 * ({@link CatalogController}) is SELLER-only.
 */
@Module({
  controllers: [AdminCatalogController, CatalogController],
  providers: [CatalogAdminService, CatalogService],
})
export class CatalogModule {}
