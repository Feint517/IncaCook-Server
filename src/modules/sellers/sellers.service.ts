import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CuisineType,
  DayOfWeek,
  DishType,
  SellerBusiness,
  SellerProfile,
} from '@prisma/client';
import { SellerCategory } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { UpsertSellerBusinessDto } from './dto/upsert-seller-business.dto';
import { UpsertSellerCuisinesDto } from './dto/upsert-seller-cuisines.dto';
import { UpsertSellerProfileDto } from './dto/upsert-seller-profile.dto';

@Injectable()
export class SellersService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------- Profile --------------------

  async upsertProfile(supabaseId: string, dto: UpsertSellerProfileDto): Promise<SellerProfile> {
    const userId = await this.assertSeller(supabaseId);

    // prepMin/prepMax sanity check.
    if (
      dto.prepMinMinutes !== undefined &&
      dto.prepMaxMinutes !== undefined &&
      dto.prepMaxMinutes < dto.prepMinMinutes
    ) {
      throw new BadRequestException('prepMaxMinutes must be >= prepMinMinutes');
    }

    // FAIT_MAISON auto-approves KYC; everyone else stays PENDING until
    // documents land + admin reviews. We only flip kycStatus when category
    // is being set — never demote APPROVED.
    const next = await this.prisma.db.sellerProfile.findUnique({
      where: { userId },
      select: { kycStatus: true, category: true },
    });

    const nextKycStatus =
      dto.category === SellerCategory.FAIT_MAISON && next?.kycStatus === 'PENDING'
        ? 'APPROVED'
        : undefined;

    return this.prisma.db.sellerProfile.update({
      where: { userId },
      data: {
        category: dto.category,
        displayName: dto.displayName,
        bio: dto.bio ?? null,
        profilePhotoUrl: dto.profilePhotoUrl,
        dateOfBirth: new Date(dto.dateOfBirth),
        neighborhood: dto.neighborhood ?? null,
        deliveryRadiusKm: dto.deliveryRadiusKm ?? null,
        deliveryFeeCents: dto.deliveryFeeCents ?? null,
        prepMinMinutes: dto.prepMinMinutes ?? null,
        prepMaxMinutes: dto.prepMaxMinutes ?? null,
        hygieneCommitment: dto.hygieneCommitment ?? null,
        faitMaisonCommitment: dto.faitMaisonCommitment ?? null,
        ...(nextKycStatus ? { kycStatus: nextKycStatus } : {}),
      },
    });
  }

  // -------------------- Business --------------------

  async upsertBusiness(
    supabaseId: string,
    dto: UpsertSellerBusinessDto,
  ): Promise<SellerBusiness & { openingHours: Array<{ dayOfWeek: DayOfWeek; startTime: Date; endTime: Date }> }> {
    const userId = await this.assertSeller(supabaseId);

    // Block business setup for fait-maison sellers — they're the only role
    // that skips this step.
    const profile = await this.prisma.db.sellerProfile.findUnique({
      where: { userId },
      select: { category: true },
    });
    if (profile?.category === SellerCategory.FAIT_MAISON) {
      throw new BadRequestException('Fait-maison sellers do not have a business profile');
    }

    if (!isValidSiret(dto.siret)) {
      throw new BadRequestException('siret must pass Luhn validation');
    }

    // SellerBusiness upsert + opening hours replace in one transaction.
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.sellerBusiness.upsert({
        where: { userId },
        create: {
          userId,
          businessName: dto.businessName,
          siret: dto.siret,
          facadeUrl: dto.facadeUrl ?? null,
          legalForm: dto.legalForm ?? null,
        },
        update: {
          businessName: dto.businessName,
          siret: dto.siret,
          facadeUrl: dto.facadeUrl ?? null,
          legalForm: dto.legalForm ?? null,
        },
      });

      // Replace the opening-hours set.
      await tx.sellerOpeningHours.deleteMany({ where: { sellerId: userId } });
      if (dto.openingHours && dto.openingHours.length > 0) {
        await tx.sellerOpeningHours.createMany({
          data: dto.openingHours.map((hr) => ({
            sellerId: userId,
            dayOfWeek: hr.dayOfWeek,
            startTime: parseTimeOfDay(hr.startTime),
            endTime: parseTimeOfDay(hr.endTime),
          })),
        });
      }

      const openingHours = await tx.sellerOpeningHours.findMany({
        where: { sellerId: userId },
        orderBy: { dayOfWeek: 'asc' },
        select: { dayOfWeek: true, startTime: true, endTime: true },
      });
      return { ...business, openingHours };
    });
  }

  // -------------------- Cuisines / Dishes --------------------

  async upsertCuisines(
    supabaseId: string,
    dto: UpsertSellerCuisinesDto,
  ): Promise<{ cuisines: CuisineType[]; dishTypes: DishType[] }> {
    const userId = await this.assertSeller(supabaseId);

    return this.prisma.$transaction(async (tx) => {
      await tx.sellerCuisine.deleteMany({ where: { userId } });
      await tx.sellerDish.deleteMany({ where: { userId } });
      await tx.sellerCuisine.createMany({
        data: dto.cuisines.map((cuisineType) => ({ userId, cuisineType })),
      });
      await tx.sellerDish.createMany({
        data: dto.dishTypes.map((dishType) => ({ userId, dishType })),
      });
      return { cuisines: dto.cuisines, dishTypes: dto.dishTypes };
    });
  }

  // -------------------- Internals --------------------

  /** Returns the User.id of a valid seller; 403 otherwise. */
  private async assertSeller(supabaseId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true, sellerProfile: { select: { userId: true } } },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role !== UserRole.Seller || !user.sellerProfile) {
      throw new ForbiddenException('Only sellers can update seller profile');
    }
    return user.id;
  }
}

function parseTimeOfDay(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(0);
  d.setUTCHours(h, m, 0, 0);
  return d;
}

/** 14 digits passing Luhn. */
function isValidSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let digit = Number(siret[i]);
    if ((13 - i) % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
