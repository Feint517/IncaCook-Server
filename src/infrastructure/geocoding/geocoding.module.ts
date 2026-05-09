import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { mapboxConfig } from '@config/mapbox.config';

import { MapboxService } from './mapbox.service';

@Module({
  imports: [ConfigModule.forFeature(mapboxConfig)],
  providers: [MapboxService],
  exports: [MapboxService],
})
export class GeocodingModule {}
