import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { AddressResponseDto } from './dto/address-response.dto';
import { BuyerProfileResponseDto } from './dto/buyer-profile-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { DriverProfileResponseDto } from './dto/driver-profile-response.dto';
import { OpeningHoursResponseDto } from './dto/opening-hours-response.dto';
import { SellerProfileResponseDto } from './dto/seller-profile-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService, type UserAggregate } from './users.service';

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Completes signup. Called by the Flutter app after Supabase Auth issues
   * a JWT but before the user lands on a role-specific home screen.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    const aggregate = await this.users.createFromJwt(
      { supabaseId: jwtUser.id, email: jwtUser.email, phone: jwtUser.phone },
      dto,
    );
    return toUserResponse(aggregate);
  }

  /** Returns the authenticated user's profile. Drives post-login routing. */
  @Get('me')
  async me(@CurrentUser() jwtUser: AuthenticatedUser): Promise<UserResponseDto> {
    const aggregate = await this.users.findBySupabaseId(jwtUser.id);
    return toUserResponse(aggregate);
  }
}

function toUserResponse(aggregate: UserAggregate): UserResponseDto {
  const buyerProfile = aggregate.buyerProfile
    ? BuyerProfileResponseDto.from(
        aggregate.buyerProfile,
        aggregate.buyerProfile.defaultAddress
          ? AddressResponseDto.from(
              aggregate.buyerProfile.defaultAddress,
              aggregate.defaultAddressCoords,
            )
          : null,
      )
    : undefined;

  const sellerProfile = aggregate.sellerProfile
    ? SellerProfileResponseDto.from(
        aggregate.sellerProfile,
        AddressResponseDto.from(aggregate.sellerProfile.pickupAddress, aggregate.pickupAddressCoords),
        aggregate.sellerProfile.openingHours.map((hr) => OpeningHoursResponseDto.from(hr)),
      )
    : undefined;

  const driverProfile = aggregate.driverProfile
    ? DriverProfileResponseDto.from(
        aggregate.driverProfile,
        AddressResponseDto.from(aggregate.driverProfile.baseAddress, aggregate.baseAddressCoords),
      )
    : undefined;

  return UserResponseDto.from(aggregate.user, { buyerProfile, sellerProfile, driverProfile });
}
