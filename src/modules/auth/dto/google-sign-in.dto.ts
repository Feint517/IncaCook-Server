import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /v1/auth/google`. Mobile-native Google Sign-In: the app
 * uses the `google_sign_in` plugin to invoke the OS-level account picker
 * and forwards the resulting Google ID token here. The backend exchanges
 * it for a Supabase session via `signInWithIdToken`.
 *
 * `nonce` is optional. The Google iOS SDK doesn't always emit one; when
 * the app does send a raw nonce alongside its hashed counterpart in the
 * ID token, pass the raw one here so Supabase can verify it.
 */
export class GoogleSignInDto {
  @IsString()
  @MinLength(20) // real Google ID tokens are ~1KB; 20 is just a sanity floor
  @MaxLength(8192)
  idToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  nonce?: string;
}
