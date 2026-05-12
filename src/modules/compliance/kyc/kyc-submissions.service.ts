import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { KycSubmission } from '@prisma/client';

import { DriverVehicleType, MOTORIZED_VEHICLES } from '@common/enums/driver-vehicle-type.enum';
import { ID_DOCUMENT_TYPES_REQUIRING_VERSO } from '@common/enums/id-document-type.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';
import { UserRole } from '@common/enums/user-role.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { CreateKycSubmissionDto } from './dto/create-kyc-submission.dto';

@Injectable()
export class KycSubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Submits or resubmits KYC documents. Insert-only — each call creates a
   * new row, preserving the audit trail. Resubmission resets the role
   * profile's kycStatus to PENDING so the user isn't still flagged as
   * REJECTED while the new submission is awaiting review.
   *
   * Open to sellers (non-fait-maison) and drivers. Drivers with motorized
   * vehicles must also send drivingLicenseUrl / carteGriseUrl / insuranceUrl.
   */
  async submit(supabaseId: string, dto: CreateKycSubmissionDto): Promise<KycSubmission> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: { sellerProfile: true, driverProfile: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    if (user.role !== UserRole.Seller && user.role !== UserRole.Driver) {
      throw new ForbiddenException('KYC submission is only for sellers and drivers');
    }

    if (user.role === UserRole.Seller) {
      if (!user.sellerProfile) {
        throw new BadRequestException('Complete seller profile before submitting KYC');
      }
      if (user.sellerProfile.category === SellerCategory.FaitMaison) {
        throw new BadRequestException('Fait-maison sellers do not submit KYC');
      }
      validateSellerDocumentShape(dto);
    } else {
      if (!user.driverProfile) {
        throw new BadRequestException('Complete driver profile before submitting KYC');
      }
      validateDriverDocumentShape(dto, user.driverProfile.vehicleType as DriverVehicleType);
    }

    const id = generateUlid();
    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.kycSubmission.create({
        data: {
          id,
          userId: user.id,
          idDocumentType: dto.idDocumentType,
          idFrontUrl: dto.idFrontUrl,
          idBackUrl: dto.idBackUrl ?? null,
          selfieUrl: dto.selfieUrl,
          drivingLicenseUrl: dto.drivingLicenseUrl ?? null,
          carteGriseUrl: dto.carteGriseUrl ?? null,
          insuranceUrl: dto.insuranceUrl ?? null,
          status: KycStatus.Pending,
        },
      });

      // Reset role-profile kycStatus from REJECTED → PENDING for the new
      // submission. APPROVED stays APPROVED — admin must explicitly flip it.
      if (user.role === UserRole.Seller && user.sellerProfile!.kycStatus === KycStatus.Rejected) {
        await tx.sellerProfile.update({
          where: { userId: user.id },
          data: { kycStatus: KycStatus.Pending },
        });
      }
      if (user.role === UserRole.Driver && user.driverProfile!.kycStatus === KycStatus.Rejected) {
        await tx.driverProfile.update({
          where: { userId: user.id },
          data: { kycStatus: KycStatus.Pending },
        });
      }

      return submission;
    });
  }

  /**
   * Returns the current user's most recent submission, or 404 if none.
   * "Current" = highest submittedAt for this user.
   */
  async findLatestForUser(supabaseId: string): Promise<KycSubmission> {
    const user = await this.prisma.db.user.findUnique({ where: { supabaseId } });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const submission = await this.prisma.db.kycSubmission.findFirst({
      where: { userId: user.id },
      orderBy: { submittedAt: 'desc' },
    });
    if (!submission) {
      throw new NotFoundException('No KYC submission yet');
    }
    return submission;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateIdDocumentShape(dto: CreateKycSubmissionDto): void {
  const requiresVerso = ID_DOCUMENT_TYPES_REQUIRING_VERSO.has(dto.idDocumentType);
  if (requiresVerso && !dto.idBackUrl) {
    throw new BadRequestException(
      `idBackUrl is required for document type ${dto.idDocumentType}`,
    );
  }
  if (!requiresVerso && dto.idBackUrl) {
    throw new BadRequestException(
      `idBackUrl must be omitted for document type ${dto.idDocumentType}`,
    );
  }
}

function validateSellerDocumentShape(dto: CreateKycSubmissionDto): void {
  validateIdDocumentShape(dto);

  if (dto.drivingLicenseUrl ?? dto.carteGriseUrl ?? dto.insuranceUrl) {
    throw new BadRequestException(
      'drivingLicenseUrl / carteGriseUrl / insuranceUrl are reserved for drivers',
    );
  }
}

function validateDriverDocumentShape(
  dto: CreateKycSubmissionDto,
  vehicleType: DriverVehicleType,
): void {
  validateIdDocumentShape(dto);

  if (MOTORIZED_VEHICLES.has(vehicleType)) {
    if (!dto.drivingLicenseUrl) {
      throw new BadRequestException('drivingLicenseUrl is required for motorized vehicles');
    }
    if (!dto.carteGriseUrl) {
      throw new BadRequestException('carteGriseUrl is required for motorized vehicles');
    }
    if (!dto.insuranceUrl) {
      throw new BadRequestException('insuranceUrl is required for motorized vehicles');
    }
  } else {
    // BICYCLE — those documents make no sense.
    if (dto.drivingLicenseUrl ?? dto.carteGriseUrl ?? dto.insuranceUrl) {
      throw new BadRequestException(
        'drivingLicenseUrl / carteGriseUrl / insuranceUrl must be omitted for non-motorized vehicles',
      );
    }
  }
}
