import { Injectable } from '@nestjs/common';

import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import { SignedUrlService } from './signed-url.service';

@Injectable()
export class StorageService {
  constructor(
    private readonly supabase: SupabaseAdminService,
    private readonly signed: SignedUrlService,
  ) {}

  generateSignedUploadUrl(bucket: string, path: string, expiresIn?: number) {
    return this.signed.createUpload(bucket, path, expiresIn);
  }

  generateSignedDownloadUrl(bucket: string, path: string, expiresIn?: number) {
    return this.signed.createDownload(bucket, path, expiresIn);
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    const { error } = await this.supabase.storage(bucket).remove([path]);
    if (error) {
      throw error;
    }
  }
}
