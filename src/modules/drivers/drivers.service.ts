import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DriverProfile } from '@prisma/client';

import { UserRole } from '@common/enums/user-role.enum';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { UpsertDriverVehicleDto } from './dto/upsert-vehicle.dto';
import { UpsertDriverZonesDto } from './dto/upsert-zones.dto';

@Injectable()
export class DriversService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertVehicle(supabaseId: string, dto: UpsertDriverVehicleDto): Promise<DriverProfile> {
    const userId = await this.assertDriver(supabaseId);

    if (dto.dateOfBirth) {
      const dob = new Date(dto.dateOfBirth);
      const eighteenYearsAgo = new Date();
      eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
      if (dob > eighteenYearsAgo) {
        throw new BadRequestException('Driver must be at least 18 years old');
      }
    }

    return this.prisma.db.driverProfile.update({
      where: { userId },
      data: {
        vehicleType: dto.vehicleType,
        ...(dto.dateOfBirth ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
      },
    });
  }

  async upsertZones(supabaseId: string, dto: UpsertDriverZonesDto): Promise<{ zones: string[] }> {
    const userId = await this.assertDriver(supabaseId);

    return this.prisma.$transaction(async (tx) => {
      await tx.driverZone.deleteMany({ where: { userId } });
      await tx.driverZone.createMany({
        data: dto.zones.map((zoneId) => ({ userId, zoneId })),
      });
      return { zones: dto.zones };
    });
  }

  // -------------------- internals --------------------

  private async assertDriver(supabaseId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true, role: true, driverProfile: { select: { userId: true } } },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role !== UserRole.Driver || !user.driverProfile) {
      throw new ForbiddenException('Only drivers can update driver profile');
    }
    return user.id;
  }
}
