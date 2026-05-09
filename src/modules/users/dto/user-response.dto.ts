import type { User } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';

import { BuyerProfileResponseDto } from './buyer-profile-response.dto';

/**
 * Public shape returned by `GET /v1/users/me` and `POST /v1/users`.
 * Excludes internal fields (supabaseId, deletedAt, terms-acceptance flags).
 *
 * `buyerProfile` is populated when the user has role = BUYER. Seller and
 * driver profiles will join here in their respective signup slices.
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

  static from(user: User, buyerProfile?: BuyerProfileResponseDto): UserResponseDto {
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
      ...(buyerProfile !== undefined ? { buyerProfile } : {}),
    };
  }
}
