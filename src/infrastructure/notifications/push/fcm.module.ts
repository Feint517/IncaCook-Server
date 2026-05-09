import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { firebaseConfig } from '@config/firebase.config';

import { FcmService } from './fcm.service';

@Module({
  imports: [ConfigModule.forFeature(firebaseConfig)],
  providers: [FcmService],
  exports: [FcmService],
})
export class FcmModule {}
