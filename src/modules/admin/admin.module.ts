import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import { AdminKycDocumentsController } from './kyc/admin-kyc-documents.controller';
import { AdminKycDocumentsService } from './kyc/admin-kyc-documents.service';

@Module({
  imports: [ConfigModule.forFeature(supabaseConfig)],
  controllers: [AdminKycDocumentsController],
  providers: [AdminKycDocumentsService],
})
export class AdminModule {}
