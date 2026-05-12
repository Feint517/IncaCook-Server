import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** Deep-link the Flutter app should be reopened on. Supabase appends the
   *  recovery access_token to it as a URL fragment. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redirectTo?: string;
}
