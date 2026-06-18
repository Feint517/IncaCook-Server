import {
  Equals,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { UserRole } from '@common/enums/user-role.enum';

const SIGNUP_ROLES = [UserRole.Buyer, UserRole.Seller, UserRole.Driver] as const;
type SignupRole = (typeof SIGNUP_ROLES)[number];

/**
 * Body for `POST /v1/users` (Gate 2 of signup, per docs/signup-flow.md).
 * Identity (email, supabaseId) is read from the JWT. `phone` is optional and
 * only used when SMS verification is skipped: it's stored UNVERIFIED on the
 * row (the verified phone, when present, still comes from Supabase auth).
 *
 * This is intentionally minimal — only name, role, and legal consent. The
 * role-specific data (addresses, KYC, business info, cuisines, vehicle,
 * etc.) is sent later via per-concept PUT endpoints (Phase B).
 *
 * Admin/Moderator roles are not assignable through this endpoint.
 */
export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsIn(SIGNUP_ROLES)
  role!: SignupRole;

  // Optional E.164 phone captured during onboarding when SMS verification is
  // skipped. Stored unverified; ignored when Supabase auth already has a
  // confirmed phone for this identity.
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'phone must be E.164 (e.g. +33612345678)' })
  phone?: string;

  // Both must be true to complete signup. Stored as separate columns so we
  // can prove which document the user actually consented to.
  @IsBoolean()
  @Equals(true, { message: 'Terms of use (CGU) must be accepted' })
  acceptedCgu!: boolean;

  @IsBoolean()
  @Equals(true, { message: 'Terms of sale (CGV) must be accepted' })
  acceptedCgv!: boolean;
}
