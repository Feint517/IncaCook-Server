import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { UserRole } from '@common/enums/user-role.enum';

import { CreateBuyerProfileDto } from './create-buyer-profile.dto';
import { CreateDriverProfileDto } from './create-driver-profile.dto';
import { CreateSellerProfileDto } from './create-seller-profile.dto';

const SIGNUP_ROLES = [UserRole.Buyer, UserRole.Seller, UserRole.Driver] as const;
type SignupRole = (typeof SIGNUP_ROLES)[number];

/**
 * Body for `POST /v1/users` — completes signup after Supabase Auth has
 * issued a JWT. Identity (email, supabaseId, phone) is read from the JWT;
 * profile + legal-consent fields come from the form.
 *
 * Admin/Moderator roles are not assignable through this endpoint.
 *
 * Role-specific blocks (`buyerProfile`, `sellerProfile`) are validated
 * structurally here and gated against `role` at the service layer —
 * sending the wrong block for the role is a 400.
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

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateBuyerProfileDto)
  buyerProfile?: CreateBuyerProfileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSellerProfileDto)
  sellerProfile?: CreateSellerProfileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateDriverProfileDto)
  driverProfile?: CreateDriverProfileDto;
}
