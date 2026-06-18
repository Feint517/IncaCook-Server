import type { UserResponseDto } from '@modules/users/dto/user-response.dto';

/**
 * Response for `POST /v1/auth/oauth/sync`. Returned after a hosted-OAuth
 * provider (Facebook) login; the Supabase JWT is validated by the global guard.
 *
 * - `profileExists: true`  → `user` holds the full profile (same shape as
 *   `GET /v1/users/me`); the client routes to the role home.
 * - `profileExists: false` + `needsEmail: false` → `email` resolved; continue
 *   onboarding (Gate 2 / `POST /v1/users`).
 * - `needsEmail: true` → the provider returned no email and none is verified;
 *   the client must collect + verify one (email OTP) before onboarding.
 */
export interface OAuthSyncResponseDto {
  profileExists: boolean;
  needsEmail: boolean;
  email: string | null;
  user: UserResponseDto | null;
}
