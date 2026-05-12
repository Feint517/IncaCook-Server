import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import { AdminKycController } from './kyc/admin-kyc.controller';
import { AdminKycService } from './kyc/admin-kyc.service';

@Module({
  imports: [ConfigModule.forFeature(supabaseConfig)],
  controllers: [AdminKycController],
  providers: [AdminKycService],
})
export class AdminModule {}
