import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import { NotificationsModule } from '@modules/notifications/notifications.module';

import { AdminKycDocumentsController } from './kyc/admin-kyc-documents.controller';
import { AdminKycDocumentsService } from './kyc/admin-kyc-documents.service';
import { AdminNotificationsController } from './notifications/admin-notifications.controller';
import { AdminNotificationsService } from './notifications/admin-notifications.service';
import { DashboardController } from './stats/dashboard.controller';
import { DashboardService } from './stats/dashboard.service';

@Module({
  imports: [ConfigModule.forFeature(supabaseConfig), NotificationsModule],
  controllers: [AdminKycDocumentsController, DashboardController, AdminNotificationsController],
  providers: [AdminKycDocumentsService, DashboardService, AdminNotificationsService],
})
export class AdminModule {}
