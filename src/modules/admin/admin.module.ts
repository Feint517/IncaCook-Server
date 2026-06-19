import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import { NotificationsModule } from '@modules/notifications/notifications.module';
import { StrikesModule } from '@modules/strikes/strikes.module';

import { AdminKycDocumentsController } from './kyc/admin-kyc-documents.controller';
import { AdminKycDocumentsService } from './kyc/admin-kyc-documents.service';
import { AdminNotificationsController } from './notifications/admin-notifications.controller';
import { AdminNotificationsService } from './notifications/admin-notifications.service';
import { DashboardController } from './stats/dashboard.controller';
import { DashboardService } from './stats/dashboard.service';
import { AdminStrikesController } from './strikes/admin-strikes.controller';

@Module({
  imports: [ConfigModule.forFeature(supabaseConfig), NotificationsModule, StrikesModule],
  controllers: [
    AdminKycDocumentsController,
    DashboardController,
    AdminNotificationsController,
    AdminStrikesController,
  ],
  providers: [AdminKycDocumentsService, DashboardService, AdminNotificationsService],
})
export class AdminModule {}
