import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { supabaseConfig } from '@config/supabase.config';

import { TrackingGateway } from './tracking.gateway';
import { WsJwtService } from './ws-jwt.service';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  imports: [ConfigModule.forFeature(supabaseConfig), MessagingModule],
  providers: [TrackingGateway, WsJwtService],
})
export class TrackingModule {}
