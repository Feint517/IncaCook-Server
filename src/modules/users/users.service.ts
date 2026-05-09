import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import type { Address, BuyerProfile, User } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

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
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findBySupabaseId(supabaseId: string): Promise<UserAggregate> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: {
        buyerProfile: { include: { defaultAddress: true } },
      },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const { buyerProfile, ...rest } = user;
    const coords = buyerProfile?.defaultAddress
      ? await this.readAddressCoords(buyerProfile.defaultAddress.id)
      : null;

    return {
      user: rest,
      buyerProfile: buyerProfile ?? null,
      defaultAddressCoords: coords,
    };
  }

  /**
   * Completes signup: creates the IncaCook `User` row backed by the Supabase
   * auth identity carried in the JWT. For BUYER, also creates the
   * BuyerProfile (and optional default Address) in the same transaction.
   *
   * SELLER and DRIVER signup are not yet implemented — they need their own
   * profile-extension slices.
   */
  async createFromJwt(identity: JwtIdentity, dto: CreateUserDto): Promise<UserAggregate> {
    if (!identity.email) {
      throw new BadRequestException('Email claim missing from token');
    }

    if (dto.role !== UserRole.Buyer) {
      // Defensive: the controller-level @IsIn allows all three roles, but
      // we only have backend support for Buyer right now.
      throw new NotImplementedException(`Signup for role ${dto.role} is not implemented yet`);
    }

    const existing = await this.prisma.db.user.findUnique({
      where: { supabaseId: identity.supabaseId },
    });
    if (existing) {
      throw new ConflictException('User profile already exists');
    }

    const userId = generateUlid();
    const addressId = dto.buyerProfile?.defaultAddress ? generateUlid() : null;
    const acceptedAt = new Date();

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
          acceptedAt,
        },
      });

      if (addressId && dto.buyerProfile?.defaultAddress) {
        const addr = dto.buyerProfile.defaultAddress;
        await tx.address.create({
          data: {
            id: addressId,
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
            WHERE "id" = ${addressId}
          `;
        }
      }

      await tx.buyerProfile.create({
        data: {
          userId,
          defaultAddressId: addressId,
          dietaryPreferences: dto.buyerProfile?.dietaryPreferences ?? [],
          allergies: dto.buyerProfile?.allergies ?? [],
        },
      });
    });

    return this.findBySupabaseId(identity.supabaseId);
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
