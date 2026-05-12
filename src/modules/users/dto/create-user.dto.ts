import { Equals, IsBoolean, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { UserRole } from '@common/enums/user-role.enum';

const SIGNUP_ROLES = [UserRole.Buyer, UserRole.Seller, UserRole.Driver] as const;
type SignupRole = (typeof SIGNUP_ROLES)[number];

/**
 * Body for `POST /v1/users` (Gate 2 of signup, per docs/signup-flow.md).
 * Identity (email, supabaseId, phone) is read from the JWT.
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

  // Both must be true to complete signup. Stored as separate columns so we
  // can prove which document the user actually consented to.
  @IsBoolean()
  @Equals(true, { message: 'Terms of use (CGU) must be accepted' })
  acceptedCgu!: boolean;

  @IsBoolean()
  @Equals(true, { message: 'Terms of sale (CGV) must be accepted' })
  acceptedCgv!: boolean;
}
