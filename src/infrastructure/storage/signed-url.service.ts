import { Injectable } from '@nestjs/common';

import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

const DEFAULT_UPLOAD_EXPIRY_SECONDS = 60 * 5;
const DEFAULT_DOWNLOAD_EXPIRY_SECONDS = 60 * 60;

@Injectable()
export class SignedUrlService {
  constructor(private readonly supabase: SupabaseAdminService) {}

  async createUpload(bucket: string, path: string, expiresIn = DEFAULT_UPLOAD_EXPIRY_SECONDS) {
    const { data, error } = await this.supabase.storage(bucket).createSignedUploadUrl(path);
    if (error) {
      throw error;
    }
    return { ...data, expiresIn };
  }

  async createDownload(bucket: string, path: string, expiresIn = DEFAULT_DOWNLOAD_EXPIRY_SECONDS) {
    const { data, error } = await this.supabase.storage(bucket).createSignedUrl(path, expiresIn);
    if (error) {
      throw error;
    }
    return data;
  }
}
