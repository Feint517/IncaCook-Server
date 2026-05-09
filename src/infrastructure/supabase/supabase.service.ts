import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

import { supabaseConfig } from '@config/supabase.config';

/**
 * Anon-key Supabase client. Subject to Row-Level Security. Rarely needed in
 * the backend — prefer SupabaseAdminService.
 */
@Injectable()
export class SupabaseService {
  public readonly client: SupabaseClient;

  constructor(@Inject(supabaseConfig.KEY) private readonly cfg: ConfigType<typeof supabaseConfig>) {
    this.client = createClient(this.cfg.url, this.cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
}
