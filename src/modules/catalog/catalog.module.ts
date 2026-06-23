import { Module } from '@nestjs/common';

import { NotificationsModule } from '@modules/notifications/notifications.module';

import { AdminCatalogClaimsController } from './admin-catalog-claims.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogClaimsService } from './catalog-claims.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

/**
 * Admin product catalog sold to sellers. `PrismaService` + `StripeService`
 * are global, so no imports are needed for those. Admin CRUD ({@link
 * AdminCatalogController}) is ADMIN-only; the seller browse/purchase surface
 * ({@link CatalogController}) is SELLER-only. After-sales (SAV) claims are
 * served by {@link CatalogClaimsService} (seller create + admin handling) and
 * need notifications to alert the seller of decisions.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [AdminCatalogController, AdminCatalogClaimsController, CatalogController],
  providers: [CatalogAdminService, CatalogService, CatalogClaimsService],
})
export class CatalogModule {}
