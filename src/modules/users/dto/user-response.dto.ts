import { UserRole } from '@common/enums/user-role.enum';

import { BuyerProfileResponseDto } from './buyer-profile-response.dto';
import { DriverProfileResponseDto } from './driver-profile-response.dto';
import { SellerProfileResponseDto } from './seller-profile-response.dto';

import type { User } from '@prisma/client';

/**
 * Public shape returned by `GET /v1/users/me` and `POST /v1/users`.
 * Excludes internal fields (supabaseId, deletedAt, terms-acceptance flags).
 *
 * Exactly one of `buyerProfile` / `sellerProfile` / `driverProfile` is
 * populated, matching the user's role.
 */
export class UserResponseDto {
  id!: string;
  email!: string;
  phone!: string | null;
  role!: UserRole;
  firstName!: string;
  lastName!: string;
  avatarPath!: string | null;
  emailVerified!: boolean;
  phoneVerified!: boolean;
  createdAt!: Date;

  buyerProfile?: BuyerProfileResponseDto;
  sellerProfile?: SellerProfileResponseDto;
  driverProfile?: DriverProfileResponseDto;

  static from(
    user: User,
    profiles: {
      buyerProfile?: BuyerProfileResponseDto;
      sellerProfile?: SellerProfileResponseDto;
      driverProfile?: DriverProfileResponseDto;
    } = {},
  ): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role as UserRole,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarPath: user.avatarPath,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      createdAt: user.createdAt,
      ...(profiles.buyerProfile !== undefined ? { buyerProfile: profiles.buyerProfile } : {}),
      ...(profiles.sellerProfile !== undefined ? { sellerProfile: profiles.sellerProfile } : {}),
      ...(profiles.driverProfile !== undefined ? { driverProfile: profiles.driverProfile } : {}),
    };
  }
}
