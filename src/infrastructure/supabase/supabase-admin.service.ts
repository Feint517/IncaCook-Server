import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

import { supabaseConfig } from '@config/supabase.config';

/**
 * Service-role Supabase client. **Bypasses RLS by design.** Used for
 * privileged storage and auth-admin operations only.
 */
@Injectable()
export class SupabaseAdminService {
  public readonly client: SupabaseClient;

  constructor(@Inject(supabaseConfig.KEY) private readonly cfg: ConfigType<typeof supabaseConfig>) {
    this.client = createClient(this.cfg.url, this.cfg.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  get auth(): SupabaseClient['auth']['admin'] {
    return this.client.auth.admin;
  }

  storage(bucket: string): ReturnType<SupabaseClient['storage']['from']> {
    return this.client.storage.from(bucket);
  }
}
