import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import { SupabaseAdminService } from './supabase-admin.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  imports: [ConfigModule.forFeature(supabaseConfig)],
  providers: [SupabaseService, SupabaseAdminService],
  exports: [SupabaseService, SupabaseAdminService],
})
export class SupabaseModule {}
