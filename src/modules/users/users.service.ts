import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddressKind, UserCharter } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { SupabaseAdminService } from '@infrastructure/supabase/supabase-admin.service';

import { CreateUserDto } from './dto/create-user.dto';
import { RecordCharterDto } from './dto/record-charter.dto';
import { UpsertAddressDto } from './dto/upsert-address.dto';

import type {
  Address,
  BuyerProfile,
  DriverProfile,
  SellerBusiness,
  SellerCuisine,
  SellerDish,
  SellerOpeningHours,
  SellerProfile,
  User,
} from '@prisma/client';

/** URL `:kind` segment → AddressKind enum mapping for cleaner URLs. */
const ADDRESS_KIND_FROM_PATH: Readonly<Record<string, AddressKind>> = {
  'buyer-delivery': AddressKind.BUYER_DELIVERY,
  'seller-pickup': AddressKind.SELLER_PICKUP,
  'driver-home': AddressKind.DRIVER_HOME,
};

export function parseAddressKind(raw: string): AddressKind {
  const kind = ADDRESS_KIND_FROM_PATH[raw];
  if (!kind) {
    throw new BadRequestException(
      `Unknown address kind '${raw}'. Expected one of: ${Object.keys(ADDRESS_KIND_FROM_PATH).join(', ')}`,
    );
  }
  return kind;
}

interface JwtIdentity {
  supabaseId: string;
  email?: string;
  phone?: string;
}

/**
 * Shape returned by /v1/users/me. Role profile rows always exist for the
 * matching role (we create empty stubs at Gate 2), but their inner fields
 * are mostly nullable — the wizard fills them in via Phase B endpoints.
 *
 * Addresses are resolved by AddressKind lookup rather than FK now; the
 * service does the role→kind mapping (BUYER_DELIVERY for buyer's default,
 * SELLER_PICKUP for seller's pickup, DRIVER_HOME for driver's base).
 */
export interface UserAggregate {
  user: User;
  buyerProfile: (BuyerProfile & { defaultAddress: Address | null }) | null;
  defaultAddressCoords: { lat: number; lng: number } | null;
  sellerProfile:
    | (SellerProfile & {
        pickupAddress: Address | null;
        business: (SellerBusiness & { openingHours: SellerOpeningHours[] }) | null;
        cuisines: SellerCuisine[];
        dishes: SellerDish[];
      })
    | null;
  pickupAddressCoords: { lat: number; lng: number } | null;
  driverProfile:
    | (DriverProfile & {
        baseAddress: Address | null;
        operatingZones: string[];
      })
    | null;
  baseAddressCoords: { lat: number; lng: number } | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: SupabaseAdminService,
  ) {}

  async findBySupabaseId(supabaseId: string): Promise<UserAggregate> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: {
        buyerProfile: true,
        sellerProfile: {
          include: {
            business: { include: { openingHours: true } },
            cuisines: true,
            dishes: true,
          },
        },
        driverProfile: { include: { zones: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const { buyerProfile, sellerProfile, driverProfile, ...rest } = user;

    // Address.kind replaces the old per-role FKs. For each role profile we
    // load the matching address (if any) and its coordinates.
    const [defaultAddress, pickupAddress, baseAddress] = await Promise.all([
      buyerProfile
        ? this.prisma.db.address.findFirst({
            where: { userId: user.id, kind: AddressKind.BUYER_DELIVERY, deletedAt: null },
            // Buyer can have several saved delivery addresses — most-recent wins.
            orderBy: { updatedAt: 'desc' },
          })
        : null,
      sellerProfile
        ? this.prisma.db.address.findFirst({
            where: { userId: user.id, kind: AddressKind.SELLER_PICKUP, deletedAt: null },
          })
        : null,
      driverProfile
        ? this.prisma.db.address.findFirst({
            where: { userId: user.id, kind: AddressKind.DRIVER_HOME, deletedAt: null },
          })
        : null,
    ]);

    const [defaultAddressCoords, pickupAddressCoords, baseAddressCoords] = await Promise.all([
      defaultAddress ? this.readAddressCoords(defaultAddress.id) : Promise.resolve(null),
      pickupAddress ? this.readAddressCoords(pickupAddress.id) : Promise.resolve(null),
      baseAddress ? this.readAddressCoords(baseAddress.id) : Promise.resolve(null),
    ]);

    return {
      user: rest,
      buyerProfile: buyerProfile ? { ...buyerProfile, defaultAddress } : null,
      defaultAddressCoords,
      sellerProfile: sellerProfile ? { ...sellerProfile, pickupAddress } : null,
      pickupAddressCoords,
      driverProfile: driverProfile
        ? {
            ...driverProfile,
            baseAddress,
            operatingZones: driverProfile.zones.map((z) => z.zoneId),
          }
        : null,
      baseAddressCoords,
    };
  }

  /**
   * Edits the caller's profile basics (display name + avatar). Any role.
   * Only provided fields are updated; returns the full refreshed aggregate
   * so the app can re-hydrate its user cache. `avatarPath` is a storage
   * object key from the upload flow.
   */
  async updateProfile(
    supabaseId: string,
    dto: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      avatarPath?: string;
    },
  ): Promise<UserAggregate> {
    const existing = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('User profile not found');
    }
    await this.prisma.db.user.update({
      where: { id: existing.id },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        // Edits the display phone on the User row. Does not touch the
        // Supabase auth phone / phoneVerified — re-verification is a
        // separate OTP flow.
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.avatarPath !== undefined ? { avatarPath: dto.avatarPath } : {}),
      },
    });
    return this.findBySupabaseId(supabaseId);
  }

  /**
   * Gate 2 of signup (see docs/signup-flow.md §2.2). Creates the IncaCook
   * `User` row backed by the Supabase auth identity in the JWT, plus an
   * empty role-specific profile stub. Role-specific data (addresses, KYC,
   * business info, cuisines, vehicle, etc.) is filled in by the wizard
   * via per-concept PUT endpoints (Phase B).
   */
  async createFromJwt(identity: JwtIdentity, dto: CreateUserDto): Promise<UserAggregate> {
    if (!identity.email) {
      throw new BadRequestException('Email claim missing from token');
    }

    const existing = await this.prisma.db.user.findUnique({
      where: { supabaseId: identity.supabaseId },
    });
    if (existing) {
      throw new ConflictException('User profile already exists');
    }

    const userId = generateUlid();

    // Mirror Supabase's verification state. Email and phone are tracked
    // independently: emailVerified reflects email_confirmed_at (set by signup
    // / email OTP), phoneVerified reflects phone_confirmed_at (set only by the
    // phone OTP flow).
    const supabaseUser = await this.admin.client.auth.admin.getUserById(identity.supabaseId);
    const emailVerified = supabaseUser.data.user?.email_confirmed_at != null;
    const phoneVerified = supabaseUser.data.user?.phone_confirmed_at != null;
    // Prefer the phone from the fresh Supabase user: the OTP step sets it there
    // (via admin) after the current JWT was issued, so `identity.phone` (a JWT
    // claim) is stale. Supabase stores E.164 without '+', so re-add it.
    const supabasePhone = supabaseUser.data.user?.phone;
    const phone = supabasePhone
      ? `+${supabasePhone.replace(/^\+/, '')}`
      : (identity.phone ?? null);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          supabaseId: identity.supabaseId,
          email: identity.email!,
          phone,
          role: dto.role,
          firstName: dto.firstName,
          lastName: dto.lastName,
          emailVerified,
          phoneVerified,
          acceptedCgu: dto.acceptedCgu,
          acceptedCgv: dto.acceptedCgv,
          acceptedAt: new Date(),
        },
      });

      // Stub role profile — empty until the wizard fills it in via Phase B
      // endpoints. Buyer's array columns default to empty so reads are
      // null-safe; seller/driver have most fields nullable.
      if (dto.role === UserRole.Buyer) {
        await tx.buyerProfile.create({ data: { userId } });
      } else if (dto.role === UserRole.Seller) {
        await tx.sellerProfile.create({ data: { userId } });
      } else if (dto.role === UserRole.Driver) {
        await tx.driverProfile.create({ data: { userId } });
      }
    });

    return this.findBySupabaseId(identity.supabaseId);
  }

  // -------------------- Addresses --------------------

  /**
   * Upserts the address of the given `kind` for this user. For singleton
   * kinds (SELLER_PICKUP / DRIVER_HOME) the partial unique idx
   * enforces one row max; for BUYER_DELIVERY the wizard's "default
   * address" step also targets a singleton so we update the most-recent
   * BUYER_DELIVERY row or create a new one.
   *
   * Also writes the PostGIS `point` column when lat/lng are provided, and
   * — for SELLER_PICKUP — denormalizes the same point onto
   * SellerProfile.location for the listing-feed radius query.
   */
  async upsertAddress(
    supabaseId: string,
    kind: AddressKind,
    dto: UpsertAddressDto,
  ): Promise<Address> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    // Role gating: kind must match the caller's role.
    const expectedRole: UserRole =
      kind === AddressKind.BUYER_DELIVERY
        ? UserRole.Buyer
        : kind === AddressKind.SELLER_PICKUP
          ? UserRole.Seller
          : UserRole.Driver;
    if (user.role !== expectedRole) {
      throw new BadRequestException(`Address kind ${kind} is reserved for ${expectedRole}`);
    }

    const existing = await this.prisma.db.address.findFirst({
      where: { userId: user.id, kind, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });

    const addressId = existing?.id ?? generateUlid();

    const row = await this.prisma.$transaction(async (tx) => {
      const upserted = existing
        ? await tx.address.update({
            where: { id: existing.id },
            data: {
              fullAddress: dto.fullAddress,
              city: dto.city,
              postalCode: dto.postalCode || null,
              type: dto.type ?? null,
              customLabel: dto.customLabel ?? null,
              apartment: dto.apartment ?? null,
              floor: dto.floor ?? null,
              digicode: dto.digicode ?? null,
              deliveryNotes: dto.deliveryNotes ?? null,
            },
          })
        : await tx.address.create({
            data: {
              id: addressId,
              userId: user.id,
              kind,
              fullAddress: dto.fullAddress,
              city: dto.city,
              postalCode: dto.postalCode || null,
              type: dto.type ?? null,
              customLabel: dto.customLabel ?? null,
              apartment: dto.apartment ?? null,
              floor: dto.floor ?? null,
              digicode: dto.digicode ?? null,
              deliveryNotes: dto.deliveryNotes ?? null,
            },
          });

      if (dto.lat !== undefined && dto.lng !== undefined) {
        await tx.$executeRaw`
          UPDATE "Address"
          SET "point" = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
          WHERE "id" = ${upserted.id}
        `;
        // Mirror the seller's pickup point onto SellerProfile.location so
        // the listing feed's radius queries don't have to join Address.
        if (kind === AddressKind.SELLER_PICKUP) {
          await tx.$executeRaw`
            UPDATE "SellerProfile"
            SET "location" = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
            WHERE "userId" = ${user.id}
          `;
        }
      }
      return upserted;
    });

    return row;
  }

  // -------------------- Address CRUD (multi-address) --------------------

  /** The AddressKind a given role owns (used when creating addresses). */
  private kindForRole(role: UserRole): AddressKind {
    switch (role) {
      case UserRole.Seller:
        return AddressKind.SELLER_PICKUP;
      case UserRole.Driver:
        return AddressKind.DRIVER_HOME;
      default:
        return AddressKind.BUYER_DELIVERY;
    }
  }

  /** All of the caller's non-deleted addresses + their coordinates. */
  async listAddresses(
    supabaseId: string,
  ): Promise<Array<{ address: Address; coords: { lat: number; lng: number } | null }>> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User profile not found');
    const rows = await this.prisma.db.address.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    const coords = await Promise.all(rows.map((r) => this.readAddressCoords(r.id)));
    return rows.map((address, i) => ({ address, coords: coords[i] }));
  }

  /** Creates a new address owned by the caller (kind derived from role). */
  async createAddress(
    supabaseId: string,
    dto: UpsertAddressDto,
  ): Promise<{ address: Address; coords: { lat: number; lng: number } | null }> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('User profile not found');
    const kind = this.kindForRole(user.role as UserRole);
    const row = await this.prisma.db.address.create({
      data: {
        id: generateUlid(),
        userId: user.id,
        kind,
        fullAddress: dto.fullAddress,
        city: dto.city,
        postalCode: dto.postalCode,
        type: dto.type ?? null,
        customLabel: dto.customLabel ?? null,
        apartment: dto.apartment ?? null,
        floor: dto.floor ?? null,
        digicode: dto.digicode ?? null,
        deliveryNotes: dto.deliveryNotes ?? null,
      },
    });
    await this.writePointIfPresent(row.id, user.id, kind, dto);
    return { address: row, coords: await this.readAddressCoords(row.id) };
  }

  /** Updates one of the caller's addresses by id (ownership enforced). */
  async updateAddressById(
    supabaseId: string,
    addressId: string,
    dto: UpsertAddressDto,
  ): Promise<{ address: Address; coords: { lat: number; lng: number } | null }> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User profile not found');
    const existing = await this.prisma.db.address.findFirst({
      where: { id: addressId, userId: user.id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Address not found');
    const row = await this.prisma.db.address.update({
      where: { id: existing.id },
      data: {
        fullAddress: dto.fullAddress,
        city: dto.city,
        postalCode: dto.postalCode,
        type: dto.type ?? null,
        customLabel: dto.customLabel ?? null,
        apartment: dto.apartment ?? null,
        floor: dto.floor ?? null,
        digicode: dto.digicode ?? null,
        deliveryNotes: dto.deliveryNotes ?? null,
      },
    });
    await this.writePointIfPresent(row.id, user.id, existing.kind, dto);
    return { address: row, coords: await this.readAddressCoords(row.id) };
  }

  /** Soft-deletes one of the caller's addresses by id (ownership enforced). */
  async deleteAddressById(supabaseId: string, addressId: string): Promise<void> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User profile not found');
    const existing = await this.prisma.db.address.findFirst({
      where: { id: addressId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Address not found');
    await this.prisma.db.address.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
  }

  /** Writes the PostGIS point (and mirrors seller pickup → SellerProfile)
   *  when lat/lng are present. Shared by create/update. */
  private async writePointIfPresent(
    addressId: string,
    userId: string,
    kind: AddressKind,
    dto: UpsertAddressDto,
  ): Promise<void> {
    if (dto.lat === undefined || dto.lng === undefined) return;
    await this.prisma.$executeRaw`
      UPDATE "Address"
      SET "point" = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
      WHERE "id" = ${addressId}
    `;
    if (kind === AddressKind.SELLER_PICKUP) {
      await this.prisma.$executeRaw`
        UPDATE "SellerProfile"
        SET "location" = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326)
        WHERE "userId" = ${userId}
      `;
    }
  }

  // -------------------- Charters --------------------

  async recordCharter(supabaseId: string, dto: RecordCharterDto): Promise<UserCharter> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    // Upsert on the composite PK so re-posting the same version is a no-op
    // (idempotent — wizards retry on flaky networks).
    return this.prisma.db.userCharter.upsert({
      where: {
        userId_charter_version: {
          userId: user.id,
          charter: dto.charter,
          version: dto.version,
        },
      },
      create: { userId: user.id, charter: dto.charter, version: dto.version },
      update: {}, // acceptedAt is fixed on first insert by DEFAULT now()
    });
  }

  // -------------------- internals --------------------

  /**
   * Reads lat/lng out of the Unsupported PostGIS `point` column. Returns
   * null when the address has no geocoded coordinates yet.
   */
  private async readAddressCoords(addressId: string): Promise<{ lat: number; lng: number } | null> {
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
