import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { StrikesModule } from '@modules/strikes/strikes.module';

import { AdminDisputesController } from './disputes/admin-disputes.controller';
import { AdminKycDocumentsController } from './kyc/admin-kyc-documents.controller';
import { AdminKycDocumentsService } from './kyc/admin-kyc-documents.service';
import { AdminNotificationsController } from './notifications/admin-notifications.controller';
import { AdminNotificationsService } from './notifications/admin-notifications.service';
import { DashboardController } from './stats/dashboard.controller';
import { DashboardService } from './stats/dashboard.service';
import { AdminStrikesController } from './strikes/admin-strikes.controller';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';

@Module({
  imports: [
    ConfigModule.forFeature(supabaseConfig),
    NotificationsModule,
    StrikesModule,
    OrdersModule,
  ],
  controllers: [
    AdminKycDocumentsController,
    DashboardController,
    AdminNotificationsController,
    AdminStrikesController,
    AdminUsersController,
    AdminDisputesController,
  ],
  providers: [
    AdminKycDocumentsService,
    DashboardService,
    AdminNotificationsService,
    AdminUsersService,
  ],
})
export class AdminModule {}
