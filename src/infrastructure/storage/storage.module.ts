import { Module } from '@nestjs/common';

import { SignedUrlService } from './signed-url.service';
import { StorageService } from './storage.service';

@Module({
  providers: [StorageService, SignedUrlService],
  exports: [StorageService, SignedUrlService],
})
export class StorageModule {}
