import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { AddressResponseDto } from './dto/address-response.dto';
import { BuyerProfileResponseDto } from './dto/buyer-profile-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { DriverProfileResponseDto } from './dto/driver-profile-response.dto';
import { OpeningHoursResponseDto } from './dto/opening-hours-response.dto';
import { RecordCharterDto } from './dto/record-charter.dto';
import { SellerProfileResponseDto } from './dto/seller-profile-response.dto';
import { UpsertAddressDto } from './dto/upsert-address.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { OnboardingStateDto } from './onboarding/dto/onboarding-state.dto';
import { OnboardingService } from './onboarding/onboarding.service';
import { UsersService, parseAddressKind, type UserAggregate } from './users.service';

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly onboarding: OnboardingService,
  ) {}

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

  /**
   * Returns the caller's onboarding completeness. Single source of truth
   * for "what's left to do?" — the Flutter wizard reads this on cold-start
   * to resume at the right screen, and after each PUT/POST to learn the
   * new `next` step. See docs/signup-flow.md §4 for the derivation rules.
   */
  @Get('me/onboarding')
  getOnboardingState(
    @CurrentUser() jwtUser: AuthenticatedUser,
  ): Promise<OnboardingStateDto> {
    return this.onboarding.getOnboardingState(jwtUser.id);
  }

  /**
   * Upserts the caller's address for the given kind. `:kind` is one of
   *   buyer-delivery / seller-pickup / driver-home
   * (kebab-case). Role-gated: kind must match the caller's role.
   */
  @Put('me/addresses/:kind')
  async upsertAddress(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('kind') kindRaw: string,
    @Body() dto: UpsertAddressDto,
  ): Promise<AddressResponseDto> {
    const kind = parseAddressKind(kindRaw);
    const row = await this.users.upsertAddress(jwtUser.id, kind, dto);
    const coords =
      dto.lat !== undefined && dto.lng !== undefined ? { lat: dto.lat, lng: dto.lng } : null;
    return AddressResponseDto.from(row, coords);
  }

  /** Records the caller's acceptance of a versioned charter (CGU, CGV,
   *  hygiene, fait-maison, punctuality, care). Idempotent. */
  @Post('me/charters')
  @HttpCode(HttpStatus.CREATED)
  async recordCharter(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: RecordCharterDto,
  ): Promise<{ charter: string; version: string; acceptedAt: Date }> {
    const row = await this.users.recordCharter(jwtUser.id, dto);
    return { charter: row.charter, version: row.version, acceptedAt: row.acceptedAt };
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
        aggregate.sellerProfile.pickupAddress
          ? AddressResponseDto.from(
              aggregate.sellerProfile.pickupAddress,
              aggregate.pickupAddressCoords,
            )
          : null,
        (aggregate.sellerProfile.business?.openingHours ?? []).map((hr) =>
          OpeningHoursResponseDto.from(hr),
        ),
      )
    : undefined;

  const driverProfile = aggregate.driverProfile
    ? DriverProfileResponseDto.from(
        aggregate.driverProfile,
        aggregate.driverProfile.baseAddress
          ? AddressResponseDto.from(
              aggregate.driverProfile.baseAddress,
              aggregate.baseAddressCoords,
            )
          : null,
        aggregate.driverProfile.operatingZones,
      )
    : undefined;

  return UserResponseDto.from(aggregate.user, { buyerProfile, sellerProfile, driverProfile });
}
