import { Module } from '@nestjs/common';

import { KycSubmissionsController } from './kyc/kyc-submissions.controller';
import { KycSubmissionsService } from './kyc/kyc-submissions.service';

@Module({
  controllers: [KycSubmissionsController],
  providers: [KycSubmissionsService],
  exports: [KycSubmissionsService],
})
export class ComplianceModule {}
