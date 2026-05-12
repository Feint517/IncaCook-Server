import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [ConfigModule.forFeature(supabaseConfig)],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
