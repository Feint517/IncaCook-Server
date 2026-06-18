import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AddressKind, UserCharter } from '@prisma/client';

import { ErrorCodes } from '@common/constants/error-codes.constants';
import { UserRole } from '@common/enums/user-role.enum';
import { DomainException } from '@common/exceptions/domain.exception';
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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: SupabaseAdminService,
  ) {}

  /**
   * Resolves the user's email, in priority order, WITHOUT trusting a raw
   * client-supplied value:
   *   1. the JWT `email` claim,
   *   2. `user_metadata.email` (set by the OAuth provider),
   *   3. an identity's `identity_data.email` (provider identity),
   *   4. a verified email on the auth user (`email` + `email_confirmed_at`,
   *      e.g. set by our email-OTP add-email flow).
   * Returns `{ email: null }` when none is available so the caller can ask the
   * user to add + verify one. `source` is logged (never the value).
   */
  private pickEmail(
    jwtEmail: string | undefined,
    authUser: {
      email?: string | null;
      email_confirmed_at?: string | null;
      user_metadata?: Record<string, unknown> | null;
      identities?: Array<{ identity_data?: Record<string, unknown> | null }> | null;
    } | null,
  ): { email: string | null; source: string } {
    const clean = (v: unknown): string | null =>
      typeof v === 'string' && v.includes('@') ? v : null;

    if (jwtEmail) return { email: jwtEmail, source: 'jwt' };

    const metaEmail = clean(authUser?.user_metadata?.email);
    if (metaEmail) return { email: metaEmail, source: 'user_metadata' };

    for (const identity of authUser?.identities ?? []) {
      const idEmail = clean(identity.identity_data?.email);
      if (idEmail) return { email: idEmail, source: 'identity_data' };
    }

    // Only an email that has actually been confirmed counts as "verified".
    if (authUser?.email && authUser.email_confirmed_at) {
      return { email: authUser.email, source: 'verified' };
    }

    return { email: null, source: 'none' };
  }

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
    const existing = await this.prisma.db.user.findUnique({
      where: { supabaseId: identity.supabaseId },
    });
    if (existing) {
      throw new ConflictException('User profile already exists');
    }

    // Mirror Supabase's verification state. Email and phone are tracked
    // independently: emailVerified reflects email_confirmed_at (set by signup
    // / email OTP), phoneVerified reflects phone_confirmed_at (set only by the
    // phone OTP flow).
    const supabaseUser = await this.admin.client.auth.admin.getUserById(identity.supabaseId);
    const authUser = supabaseUser.data.user;

    // Resolve the email (jwt → user_metadata → identity_data → verified). An
    // OAuth provider (e.g. Facebook) can omit the top-level claim, so we fall
    // back to the provider metadata / a previously OTP-verified address before
    // refusing. Never trust a raw client-supplied email.
    const { email, source } = this.pickEmail(identity.email, authUser);
    this.logger.log(`createFromJwt: email source=${source}`);
    if (!email) {
      throw new DomainException(
        ErrorCodes.EmailRequired,
        'Veuillez ajouter et vérifier votre adresse email.',
        HttpStatus.FORBIDDEN,
      );
    }

    // Reject the case where another Supabase identity already owns this email
    // (e.g. the email originally signed up with password/Google and Supabase
    // identity-linking is off). Without this the `tx.user.create` below blows
    // up with an opaque P2002 on the unique email index.
    await this.assertEmailAvailableForIdentity(identity.supabaseId, email);

    const userId = generateUlid();

    const emailVerified = authUser?.email_confirmed_at != null;
    const phoneVerified = authUser?.phone_confirmed_at != null;
    // Prefer the phone from the fresh Supabase user: the OTP step sets it there
    // (via admin) after the current JWT was issued, so `identity.phone` (a JWT
    // claim) is stale. Supabase stores E.164 without '+', so re-add it.
    const supabasePhone = authUser?.phone;
    let phone = supabasePhone ? `+${supabasePhone.replace(/^\+/, '')}` : (identity.phone ?? null);

    // SMS verification skipped: persist the number typed during onboarding as
    // UNVERIFIED (phoneVerified stays false) when Supabase has no confirmed
    // phone. `User.phone` is @unique, so drop it silently if another account
    // already owns it — a duplicate must never block account creation.
    if (!phone && dto.phone) {
      const taken = await this.prisma.db.user.findFirst({
        where: { phone: dto.phone, NOT: { supabaseId: identity.supabaseId } },
        select: { id: true },
      });
      if (taken) {
        this.logger.warn('createFromJwt: typed phone already in use — saved as null');
      } else {
        phone = dto.phone;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          supabaseId: identity.supabaseId,
          email,
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

  /**
   * Idempotent post-OAuth identity sync (POST /v1/auth/oauth/sync). The
   * Supabase JWT has already been validated by the global guard; here we just
   * answer "does this Supabase identity have an IncaCook profile yet?" and
   * guard against an email collision so the caller can route accordingly:
   *   - `hasProfile: true`  → returning user, full aggregate attached.
   *   - `hasProfile: false` → first OAuth login; the client continues the
   *     normal onboarding wizard (which calls `createFromJwt` / Gate 2).
   *
   * Does NOT create the row — onboarding owns that, since role + name + legal
   * consent are required and aren't in the token. Preserves onboarding state.
   */
  async syncFromJwt(identity: JwtIdentity): Promise<{
    hasProfile: boolean;
    aggregate: UserAggregate | null;
    email: string | null;
    needsEmail: boolean;
  }> {
    const existing = await this.prisma.db.user.findUnique({
      where: { supabaseId: identity.supabaseId },
      select: { id: true },
    });
    if (existing) {
      const aggregate = await this.findBySupabaseId(identity.supabaseId);
      return { hasProfile: true, aggregate, email: aggregate.user.email, needsEmail: false };
    }

    // No profile yet — resolve the email so the client knows whether to show
    // the "complete email" step before onboarding (Facebook may return none).
    const supabaseUser = await this.admin.client.auth.admin.getUserById(identity.supabaseId);
    const { email, source } = this.pickEmail(identity.email, supabaseUser.data.user);
    this.logger.log(`syncFromJwt: profileExists=false email source=${source}`);
    if (email) {
      await this.assertEmailAvailableForIdentity(identity.supabaseId, email);
    }
    return { hasProfile: false, aggregate: null, email, needsEmail: email == null };
  }

  /**
   * Rejects creating/linking a profile when a *different* Supabase identity
   * already owns `email` (email is @unique). Shared by Gate 2 creation and
   * the OAuth sync so "avoid duplicate users by email" holds on both paths.
   */
  private async assertEmailAvailableForIdentity(supabaseId: string, email: string): Promise<void> {
    const owner = await this.prisma.db.user.findFirst({
      where: { email, NOT: { supabaseId } },
      select: { id: true },
    });
    if (owner) {
      throw new ConflictException(
        "Un compte existe déjà avec cette adresse e-mail. Connectez-vous avec votre méthode d'origine.",
      );
    }
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
