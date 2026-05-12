import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { KycDocument } from '@prisma/client';
import { KycDocType, KycStatus, Prisma } from '@prisma/client';

import { DriverVehicleType, MOTORIZED_VEHICLES } from '@common/enums/driver-vehicle-type.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';
import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { UpsertKycDocumentDto } from './dto/upsert-kyc-document.dto';

/** Doc slots that are role-gated. Everything not listed is open to both. */
const SELLER_ALLOWED: ReadonlySet<KycDocType> = new Set([
  KycDocType.ID_FRONT,
  KycDocType.ID_BACK,
  KycDocType.SELFIE,
]);
const DRIVER_MOTORIZED_ONLY: ReadonlySet<KycDocType> = new Set([
  KycDocType.DRIVING_LICENSE,
  KycDocType.CARTE_GRISE,
  KycDocType.INSURANCE,
]);

@Injectable()
export class KycDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts one KycDocument row keyed on (userId, type). A new upload for
   * the same slot replaces the previous file URL and resets reviewState to
   * PENDING. The seller/driver role profile's mirrored kycStatus is bumped
   * back to PENDING if it had been REJECTED (so the user isn't still
   * flagged while awaiting re-review). APPROVED never auto-flips back.
   */
  async upsert(supabaseId: string, dto: UpsertKycDocumentDto): Promise<KycDocument> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: { sellerProfile: true, driverProfile: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role !== UserRole.Seller && user.role !== UserRole.Driver) {
      throw new ForbiddenException('KYC documents are only for sellers and drivers');
    }

    // Role + category gating on which slot the user is allowed to fill.
    if (user.role === UserRole.Seller) {
      if (!user.sellerProfile) {
        throw new BadRequestException('Seller profile missing');
      }
      if (user.sellerProfile.category === SellerCategory.FaitMaison) {
        throw new BadRequestException('Fait-maison sellers do not submit KYC');
      }
      if (!SELLER_ALLOWED.has(dto.type)) {
        throw new BadRequestException(`Seller cannot submit a ${dto.type} document`);
      }
    } else {
      if (!user.driverProfile) {
        throw new BadRequestException('Driver profile missing');
      }
      if (DRIVER_MOTORIZED_ONLY.has(dto.type)) {
        const vehicleType = user.driverProfile.vehicleType as DriverVehicleType | null;
        if (!vehicleType) {
          throw new BadRequestException('Set vehicle type before submitting motorized documents');
        }
        if (!MOTORIZED_VEHICLES.has(vehicleType)) {
          throw new BadRequestException(`${dto.type} is for motorized vehicles only`);
        }
      }
    }

    // ID_FRONT / ID_BACK rows carry the kind of ID in metadata; the Flutter
    // app is expected to send it (the wizard collects it on the ID screen).
    if ((dto.type === KycDocType.ID_FRONT || dto.type === KycDocType.ID_BACK) && !dto.idDocumentType) {
      throw new BadRequestException('idDocumentType is required for ID_FRONT / ID_BACK');
    }

    const metadata =
      dto.idDocumentType !== undefined ? { idDocumentType: dto.idDocumentType } : null;

    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.kycDocument.upsert({
        where: { userId_type: { userId: user.id, type: dto.type } },
        create: {
          id: generateUlid(),
          userId: user.id,
          type: dto.type,
          fileUrl: dto.fileUrl,
          reviewState: KycStatus.PENDING,
          metadata: metadata !== null ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
        update: {
          fileUrl: dto.fileUrl,
          reviewState: KycStatus.PENDING,
          rejectionReason: null,
          reviewerId: null,
          reviewedAt: null,
          metadata: metadata !== null ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
          submittedAt: new Date(),
        },
      });

      // Reset role-profile kycStatus from REJECTED → PENDING when any
      // document is re-uploaded. APPROVED is sticky.
      if (user.role === UserRole.Seller && user.sellerProfile!.kycStatus === KycStatus.REJECTED) {
        await tx.sellerProfile.update({
          where: { userId: user.id },
          data: { kycStatus: KycStatus.PENDING },
        });
      }
      if (user.role === UserRole.Driver && user.driverProfile!.kycStatus === KycStatus.REJECTED) {
        await tx.driverProfile.update({
          where: { userId: user.id },
          data: { kycStatus: KycStatus.PENDING },
        });
      }

      return doc;
    });
  }

  /** Lists every KycDocument row owned by the caller (one per type). */
  async listForUser(supabaseId: string): Promise<KycDocument[]> {
    const user = await this.prisma.db.user.findUnique({ where: { supabaseId } });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    return this.prisma.db.kycDocument.findMany({
      where: { userId: user.id },
      orderBy: { type: 'asc' },
    });
  }
}
