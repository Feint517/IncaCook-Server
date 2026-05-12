import { Module } from '@nestjs/common';

import { ChartersController } from './charters/charters.controller';
import { KycDocumentsController } from './kyc/kyc-documents.controller';
import { KycDocumentsService } from './kyc/kyc-documents.service';

@Module({
  controllers: [ChartersController, KycDocumentsController],
  providers: [KycDocumentsService],
  exports: [KycDocumentsService],
})
export class ComplianceModule {}
