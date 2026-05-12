import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { UserRole } from '@common/enums/user-role.enum';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { BuyerPreferencesResponseDto } from './dto/buyer-preferences-response.dto';
import { UpsertBuyerPreferencesDto } from './dto/upsert-preferences.dto';

@Injectable()
export class BuyersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Replaces the buyer's dietary preferences and allergens in one shot.
   * The BuyerProfile row was already created at Gate 2 (POST /v1/users), so
   * this is always an update — no upsert needed.
   */
  async upsertPreferences(
    supabaseId: string,
    dto: UpsertBuyerPreferencesDto,
  ): Promise<BuyerPreferencesResponseDto> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true, buyerProfile: { select: { userId: true } } },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role !== UserRole.Buyer || !user.buyerProfile) {
      throw new ForbiddenException('Only buyers can manage preferences');
    }

    const updated = await this.prisma.db.buyerProfile.update({
      where: { userId: user.id },
      data: {
        dietaryPreferences: dto.dietaryTags,
        allergies: dto.allergens,
      },
      select: { dietaryPreferences: true, allergies: true },
    });

    return {
      dietaryTags: updated.dietaryPreferences,
      allergens: updated.allergies,
    };
  }
}
