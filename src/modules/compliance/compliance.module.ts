import { Module } from '@nestjs/common';

import { NotificationsModule } from '@modules/notifications/notifications.module';

import { ChartersController } from './charters/charters.controller';
import { KycDocumentsController } from './kyc/kyc-documents.controller';
import { KycDocumentsService } from './kyc/kyc-documents.service';
import { AdminLegalDocumentsController } from './legal-documents/admin-legal-documents.controller';
import { LegalDocumentsController } from './legal-documents/legal-documents.controller';
import { LegalDocumentsService } from './legal-documents/legal-documents.service';

@Module({
  // NotificationsModule provides NotificationsService for the "terms updated"
  // broadcast sent when an admin publishes a new CGU/CGV version.
  imports: [NotificationsModule],
  controllers: [
    ChartersController,
    KycDocumentsController,
    LegalDocumentsController,
    AdminLegalDocumentsController,
  ],
  providers: [KycDocumentsService, LegalDocumentsService],
  exports: [KycDocumentsService, LegalDocumentsService],
})
export class ComplianceModule {}
