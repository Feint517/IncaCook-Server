import { Module } from '@nestjs/common';

import { AdminReportsController } from './admin-reports.controller';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Moderation: user-submitted reports (`POST /v1/reports`) reviewed by admins
 * (`GET /v1/admin/reports`, `PATCH /v1/admin/reports/:id/status`). PrismaService
 * is global; no extra imports needed.
 */
@Module({
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
})
export class ModerationModule {}
