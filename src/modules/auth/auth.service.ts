import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  // Auth flows (sign-in, sign-up, refresh, password reset) are owned by
  // Supabase Auth on the client side. The backend only validates JWTs via
  // SupabaseJwtStrategy. Server-side flows (impersonation, admin-only
  // operations) will be added here in subsequent tasks.
}
