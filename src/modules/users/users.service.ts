import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Address,
  BuyerProfile,
  DriverProfile,
  SellerOpeningHours,
  SellerProfile,
  User,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { KycStatus } from '@common/enums/kyc-status.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';
import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { CreateAddressDto } from './dto/create-address.dto';
import { CreateDriverProfileDto } from './dto/create-driver-profile.dto';
import { CreateOpeningHoursDto } from './dto/create-opening-hours.dto';
import { CreateSellerProfileDto } from './dto/create-seller-profile.dto';
import { CreateUserDto } from './dto/create-user.dto';

interface JwtIdentity {
  supabaseId: string;
  email?: string;
  phone?: string;
}

export interface UserAggregate {
  user: User;
  buyerProfile: (BuyerProfile & { defaultAddress: Address | null }) | null;
  /** Lat/lng of the buyer's default address, when geocoded. */
  defaultAddressCoords: { lat: number; lng: number } | null;
  sellerProfile:
    | (SellerProfile & {
        pickupAddress: Address;
        openingHours: SellerOpeningHours[];
      })
    | null;
  /** Lat/lng of the seller's pickup address, when geocoded. */
  pickupAddressCoords: { lat: number; lng: number } | null;
  driverProfile: (DriverProfile & { baseAddress: Address }) | null;
  /** Lat/lng of the driver's base address, when geocoded. */
  baseAddressCoords: { lat: number; lng: number } | null;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findBySupabaseId(supabaseId: string): Promise<UserAggregate> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: {
        buyerProfile: { include: { defaultAddress: true } },
        sellerProfile: {
          include: {
            pickupAddress: true,
            openingHours: true,
          },
        },
        driverProfile: { include: { baseAddress: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const { buyerProfile, sellerProfile, driverProfile, ...rest } = user;

    const defaultAddressCoords = buyerProfile?.defaultAddress
      ? await this.readAddressCoords(buyerProfile.defaultAddress.id)
      : null;
    const pickupAddressCoords = sellerProfile?.pickupAddress
      ? await this.readAddressCoords(sellerProfile.pickupAddress.id)
      : null;
    const baseAddressCoords = driverProfile?.baseAddress
      ? await this.readAddressCoords(driverProfile.baseAddress.id)
      : null;

    return {
      user: rest,
      buyerProfile: buyerProfile ?? null,
      defaultAddressCoords,
      sellerProfile: sellerProfile ?? null,
      pickupAddressCoords,
      driverProfile: driverProfile ?? null,
      baseAddressCoords,
    };
  }

  /**
   * Completes signup: creates the IncaCook `User` row backed by the Supabase
   * auth identity carried in the JWT, plus any role-specific profile.
   *
   *   role = BUYER:  User + (optional Address) + BuyerProfile
   *   role = SELLER: User + Address (pickup) + SellerProfile + opening hours
   *   role = DRIVER: not yet implemented
   */
  async createFromJwt(identity: JwtIdentity, dto: CreateUserDto): Promise<UserAggregate> {
    if (!identity.email) {
      throw new BadRequestException('Email claim missing from token');
    }

    // Cross-role mismatch checks: only the matching profile block is allowed.
    if (dto.role !== UserRole.Buyer && dto.buyerProfile) {
      throw new BadRequestException('buyerProfile is only allowed for role=BUYER');
    }
    if (dto.role !== UserRole.Seller && dto.sellerProfile) {
      throw new BadRequestException('sellerProfile is only allowed for role=SELLER');
    }
    if (dto.role !== UserRole.Driver && dto.driverProfile) {
      throw new BadRequestException('driverProfile is only allowed for role=DRIVER');
    }
    if (dto.role === UserRole.Seller && !dto.sellerProfile) {
      throw new BadRequestException('sellerProfile is required for role=SELLER');
    }
    if (dto.role === UserRole.Driver && !dto.driverProfile) {
      throw new BadRequestException('driverProfile is required for role=DRIVER');
    }

    const existing = await this.prisma.db.user.findUnique({
      where: { supabaseId: identity.supabaseId },
    });
    if (existing) {
      throw new ConflictException('User profile already exists');
    }

    if (dto.role === UserRole.Seller && dto.sellerProfile) {
      validateSellerProfile(dto.sellerProfile);
    }
    if (dto.role === UserRole.Driver && dto.driverProfile) {
      validateDriverProfile(dto.driverProfile);
    }

    const userId = generateUlid();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          supabaseId: identity.supabaseId,
          email: identity.email!,
          phone: identity.phone ?? null,
          role: dto.role,
          firstName: dto.firstName,
          lastName: dto.lastName,
          acceptedCgu: dto.acceptedCgu,
          acceptedCgv: dto.acceptedCgv,
          acceptedAt: new Date(),
        },
      });

      if (dto.role === UserRole.Buyer) {
        await this.createBuyerSlice(tx, userId, dto);
      } else if (dto.role === UserRole.Seller) {
        await this.createSellerSlice(tx, userId, dto.sellerProfile!);
      } else if (dto.role === UserRole.Driver) {
        await this.createDriverSlice(tx, userId, dto.driverProfile!);
      }
    });

    return this.findBySupabaseId(identity.supabaseId);
  }

  // ---------- per-role create helpers ----------

  private async createBuyerSlice(tx: Tx, userId: string, dto: CreateUserDto): Promise<void> {
    const addressDto = dto.buyerProfile?.defaultAddress;
    let defaultAddressId: string | null = null;

    if (addressDto) {
      defaultAddressId = await this.createAddress(tx, userId, addressDto);
    }

    await tx.buyerProfile.create({
      data: {
        userId,
        defaultAddressId,
        dietaryPreferences: dto.buyerProfile?.dietaryPreferences ?? [],
        allergies: dto.buyerProfile?.allergies ?? [],
      },
    });
  }

  private async createSellerSlice(
    tx: Tx,
    userId: string,
    seller: CreateSellerProfileDto,
  ): Promise<void> {
    const pickupAddressId = await this.createAddress(tx, userId, seller.pickupAddress);

    // Application-side mirror of the trigger's behavior so the client gets
    // the correct kycStatus back without an extra refetch round-trip.
    const kycStatus =
      seller.category === SellerCategory.FaitMaison ? KycStatus.Approved : KycStatus.Pending;

    await tx.sellerProfile.create({
      data: {
        userId,
        category: seller.category,
        displayName: seller.displayName,
        bio: seller.bio ?? null,
        profilePhotoUrl: seller.profilePhotoUrl,
        dateOfBirth: new Date(seller.dateOfBirth),
        pickupAddressId,
        businessName: seller.businessName ?? null,
        siret: seller.siret ?? null,
        restaurantFacadeUrl: seller.restaurantFacadeUrl ?? null,
        cuisineTypes: seller.cuisineTypes,
        dishTypes: seller.dishTypes,
        hygieneCommitment: seller.hygieneCommitment,
        faitMaisonCommitment: seller.faitMaisonCommitment,
        deliveryRadiusKm: seller.deliveryRadiusKm,
        deliveryFeeCents: seller.deliveryFeeCents,
        prepMinMinutes: seller.prepMinMinutes,
        prepMaxMinutes: seller.prepMaxMinutes,
        neighborhood: seller.neighborhood,
        languageCodes: seller.languageCodes,
        availabilitySchedule: seller.availabilitySchedule ?? null,
        promoText: seller.promoText ?? null,
        categoryTag: seller.categoryTag ?? null,
        kycStatus,
      },
    });

    // Denormalize the pickup point onto SellerProfile.location for the
    // listing-feed radius queries. Only when the address has coordinates;
    // otherwise the geocoding job populates both later.
    if (seller.pickupAddress.lat !== undefined && seller.pickupAddress.lng !== undefined) {
      await tx.$executeRaw`
        UPDATE "SellerProfile"
        SET "location" = ST_SetSRID(ST_MakePoint(${seller.pickupAddress.lng}, ${seller.pickupAddress.lat}), 4326)
        WHERE "userId" = ${userId}
      `;
    }

    if (seller.openingHours && seller.openingHours.length > 0) {
      await tx.sellerOpeningHours.createMany({
        data: seller.openingHours.map((hr) => ({
          sellerId: userId,
          dayOfWeek: hr.dayOfWeek,
          startTime: parseTimeOfDay(hr.startTime),
          endTime: parseTimeOfDay(hr.endTime),
        })),
      });
    }
  }

  private async createDriverSlice(
    tx: Tx,
    userId: string,
    driver: CreateDriverProfileDto,
  ): Promise<void> {
    const baseAddressId = await this.createAddress(tx, userId, driver.baseAddress);

    await tx.driverProfile.create({
      data: {
        userId,
        dateOfBirth: new Date(driver.dateOfBirth),
        baseAddressId,
        vehicleType: driver.vehicleType,
        operatingZones: driver.operatingZones,
        charterAccepted: driver.charterAccepted,
        punctualityCommitment: driver.punctualityCommitment,
        careCommitment: driver.careCommitment,
        kycStatus: KycStatus.Pending,
      },
    });
  }

  private async createAddress(tx: Tx, userId: string, addr: CreateAddressDto): Promise<string> {
    const id = generateUlid();
    await tx.address.create({
      data: {
        id,
        userId,
        type: addr.type ?? null,
        customLabel: addr.customLabel ?? null,
        fullAddress: addr.fullAddress,
        city: addr.city,
        postalCode: addr.postalCode,
        apartment: addr.apartment ?? null,
        floor: addr.floor ?? null,
        digicode: addr.digicode ?? null,
        deliveryNotes: addr.deliveryNotes ?? null,
      },
    });

    if (addr.lat !== undefined && addr.lng !== undefined) {
      // PostGIS ST_MakePoint is (longitude, latitude) — easy to flip.
      await tx.$executeRaw`
        UPDATE "Address"
        SET "point" = ST_SetSRID(ST_MakePoint(${addr.lng}, ${addr.lat}), 4326)
        WHERE "id" = ${id}
      `;
    }

    return id;
  }

  /**
   * Reads lat/lng out of the Unsupported PostGIS `point` column. Returns
   * null when the address has no geocoded coordinates yet.
   */
  private async readAddressCoords(
    addressId: string,
  ): Promise<{ lat: number; lng: number } | null> {
    const rows = await this.prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT
        ST_Y("point"::geometry)::float8 AS "lat",
        ST_X("point"::geometry)::float8 AS "lng"
      FROM "Address"
      WHERE "id" = ${addressId} AND "point" IS NOT NULL
    `;
    return rows[0] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateSellerProfile(seller: CreateSellerProfileDto): void {
  // Conditional fields by category.
  if (seller.category !== SellerCategory.FaitMaison) {
    if (!seller.businessName) {
      throw new BadRequestException('businessName is required when category != FAIT_MAISON');
    }
    if (!seller.siret) {
      throw new BadRequestException('siret is required when category != FAIT_MAISON');
    }
    if (!isValidSiret(seller.siret)) {
      throw new BadRequestException('siret must be 14 digits and pass Luhn validation');
    }
  }

  if (seller.category === SellerCategory.Restaurant) {
    if (!seller.restaurantFacadeUrl) {
      throw new BadRequestException('restaurantFacadeUrl is required when category = RESTAURANT');
    }
    if (!seller.openingHours || seller.openingHours.length === 0) {
      throw new BadRequestException('openingHours is required when category = RESTAURANT');
    }
  } else {
    if (seller.openingHours && seller.openingHours.length > 0) {
      throw new BadRequestException(
        'openingHours is only allowed when category = RESTAURANT',
      );
    }
  }

  if (seller.prepMaxMinutes < seller.prepMinMinutes) {
    throw new BadRequestException('prepMaxMinutes must be >= prepMinMinutes');
  }

  if (seller.cuisineTypes.length === 0) {
    throw new BadRequestException('cuisineTypes must contain at least one value');
  }
  if (seller.dishTypes.length === 0) {
    throw new BadRequestException('dishTypes must contain at least one value');
  }

  validateOpeningHours(seller.openingHours ?? []);
}

function validateDriverProfile(driver: CreateDriverProfileDto): void {
  // class-validator already enforces all three commitments are true via
  // @Equals(true) — this is a defensive belt-and-braces check.
  if (!driver.charterAccepted || !driver.punctualityCommitment || !driver.careCommitment) {
    throw new BadRequestException('All driver commitments must be accepted');
  }

  // Driver must be at least 18 on the day of signup.
  const dob = new Date(driver.dateOfBirth);
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  if (dob > eighteenYearsAgo) {
    throw new BadRequestException('Driver must be at least 18 years old');
  }
}

function validateOpeningHours(hours: CreateOpeningHoursDto[]): void {
  const seenDays = new Set<string>();
  for (const hr of hours) {
    if (seenDays.has(hr.dayOfWeek)) {
      throw new BadRequestException(`Duplicate opening hours for ${hr.dayOfWeek}`);
    }
    seenDays.add(hr.dayOfWeek);

    if (timeToMinutes(hr.endTime) <= timeToMinutes(hr.startTime)) {
      throw new BadRequestException(
        `Opening hours for ${hr.dayOfWeek}: endTime must be after startTime`,
      );
    }
  }
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function parseTimeOfDay(hhmm: string): Date {
  // Postgres `time` accepts a JS Date and uses only the time portion. Build
  // a Date in UTC so we don't get tz-shifted on the way in.
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(0);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

/** SIRET = 14 digits passing Luhn. */
function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = Number(siret[i]);
    // Luhn from the right: even indices (0-based, rightmost is 13 → even when
    // counting from the right) are doubled. Easier: double every other digit
    // starting from the second-to-last.
    if ((13 - i) % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
