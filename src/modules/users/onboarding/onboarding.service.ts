import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AddressKind,
  CharterKind,
  KycDocType,
  KycStatus,
  SellerCategory,
} from '@prisma/client';

import {
  DriverVehicleType,
  MOTORIZED_VEHICLES,
} from '@common/enums/driver-vehicle-type.enum';
import {
  ID_DOCUMENT_TYPES_REQUIRING_VERSO,
  IdDocumentType,
} from '@common/enums/id-document-type.enum';
import { UserRole } from '@common/enums/user-role.enum';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { ACTIVE_CHARTER_VERSIONS } from '@modules/compliance/charters/charters.constants';

import {
  BuyerStepKey,
  DriverStepKey,
  OnboardingStateDto,
  SellerStepKey,
  StepStatus,
} from './dto/onboarding-state.dto';

/** Wizard step order per role. `next` is the first incomplete step here. */
const BUYER_ORDER: readonly BuyerStepKey[] = ['addresses', 'preferences'] as const;

const SELLER_ORDER: readonly SellerStepKey[] = [
  'profile',
  'addresses',
  'business',
  'cuisines',
  'kyc_id',
  'kyc_selfie',
  'charter',
] as const;

const DRIVER_ORDER: readonly DriverStepKey[] = [
  'addresses',
  'vehicle',
  'zones',
  'kyc_id',
  'kyc_selfie',
  'documents',
  'charter',
] as const;

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Derives per-step completeness from the underlying tables. Single
   * source of truth for "what's left for this user to do?" — the Flutter
   * wizard's resume cursor reads from here, the listings RLS reads
   * canList from here, etc.
   */
  async getOnboardingState(supabaseId: string): Promise<OnboardingStateDto> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      include: {
        buyerProfile: true,
        sellerProfile: {
          include: { business: true, _count: { select: { cuisines: true } } },
        },
        driverProfile: { include: { _count: { select: { zones: true } } } },
      },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    if (user.role === UserRole.Admin || user.role === UserRole.Moderator) {
      throw new ForbiddenException('Onboarding state is only for buyer / seller / driver roles');
    }

    if (user.role === UserRole.Buyer) {
      return this.buyerState(user.id);
    }
    if (user.role === UserRole.Seller && user.sellerProfile) {
      return this.sellerState(user.id, {
        category: user.sellerProfile.category,
        kycStatus: user.sellerProfile.kycStatus,
        hasBusiness: user.sellerProfile.business !== null,
        cuisineCount: user.sellerProfile._count.cuisines,
      });
    }
    if (user.role === UserRole.Driver && user.driverProfile) {
      return this.driverState(user.id, {
        kycStatus: user.driverProfile.kycStatus,
        vehicleType: user.driverProfile.vehicleType as DriverVehicleType | null,
        zoneCount: user.driverProfile._count.zones,
      });
    }
    // Roles match but stub profile missing (shouldn't happen post-Gate-2).
    throw new ForbiddenException('Role profile missing — re-call POST /v1/users');
  }

  // -------------------- Buyer --------------------

  private async buyerState(userId: string): Promise<OnboardingStateDto> {
    const [addresses, profile] = await Promise.all([
      this.prisma.db.address.findFirst({
        where: { userId, kind: AddressKind.BUYER_DELIVERY, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.db.buyerProfile.findUnique({
        where: { userId },
        select: { createdAt: true, updatedAt: true, dietaryPreferences: true, allergies: true },
      }),
    ]);

    const preferencesTouched = profile
      ? profile.updatedAt.getTime() > profile.createdAt.getTime() ||
        profile.dietaryPreferences.length > 0 ||
        profile.allergies.length > 0
      : false;

    const steps: Record<BuyerStepKey, StepStatus> = {
      addresses: addresses ? 'complete' : 'incomplete',
      preferences: preferencesTouched ? 'complete' : 'incomplete',
    };

    return {
      role: 'BUYER',
      next: firstIncomplete(BUYER_ORDER, steps),
      steps,
    };
  }

  // -------------------- Seller --------------------

  private async sellerState(
    userId: string,
    summary: {
      category: SellerCategory | null;
      kycStatus: KycStatus;
      hasBusiness: boolean;
      cuisineCount: number;
    },
  ): Promise<OnboardingStateDto> {
    const [pickupAddress, sellerProfile, kycDocs] = await Promise.all([
      this.prisma.db.address.findFirst({
        where: { userId, kind: AddressKind.SELLER_PICKUP, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.db.sellerProfile.findUnique({
        where: { userId },
        select: { displayName: true, profilePhotoUrl: true, dateOfBirth: true },
      }),
      this.prisma.db.kycDocument.findMany({
        where: { userId },
        select: { type: true, reviewState: true, metadata: true },
      }),
    ]);

    const profileComplete = !!(
      sellerProfile &&
      sellerProfile.displayName &&
      sellerProfile.profilePhotoUrl &&
      sellerProfile.dateOfBirth &&
      summary.category
    );

    const isFaitMaison = summary.category === SellerCategory.FAIT_MAISON;

    // Business step: required for non-fait-maison, skipped for fait-maison.
    const businessStatus: StepStatus = isFaitMaison
      ? 'skipped'
      : summary.hasBusiness
        ? 'complete'
        : 'incomplete';

    // Fait-maison sellers don't go through KYC at all (auto-approved at
    // signup). Their KYC steps are skipped.
    const kycIdStatus: StepStatus = isFaitMaison
      ? 'skipped'
      : derivKycIdStatus(kycDocs);
    const kycSelfieStatus: StepStatus = isFaitMaison
      ? 'skipped'
      : derivSlotStatus(kycDocs, KycDocType.SELFIE);

    // Required charters: HYGIENE always for sellers; FAIT_MAISON additionally
    // for fait-maison.
    const requiredCharters: CharterKind[] = isFaitMaison
      ? [CharterKind.HYGIENE, CharterKind.FAIT_MAISON]
      : [CharterKind.HYGIENE];
    const charterStatus = await this.charterStatus(userId, requiredCharters);

    const steps: Record<SellerStepKey, StepStatus> = {
      profile: profileComplete ? 'complete' : 'incomplete',
      addresses: pickupAddress ? 'complete' : 'incomplete',
      business: businessStatus,
      cuisines: summary.cuisineCount > 0 ? 'complete' : 'incomplete',
      kyc_id: kycIdStatus,
      kyc_selfie: kycSelfieStatus,
      charter: charterStatus,
    };

    const allDone = Object.values(steps).every(
      (s) => s === 'complete' || s === 'skipped',
    );
    const canList = allDone && summary.kycStatus === KycStatus.APPROVED;

    return {
      role: 'SELLER',
      next: firstIncomplete(SELLER_ORDER, steps),
      steps,
      kycReviewState: summary.kycStatus,
      canList,
    };
  }

  // -------------------- Driver --------------------

  private async driverState(
    userId: string,
    summary: {
      kycStatus: KycStatus;
      vehicleType: DriverVehicleType | null;
      zoneCount: number;
    },
  ): Promise<OnboardingStateDto> {
    const [baseAddress, driverProfile, kycDocs] = await Promise.all([
      this.prisma.db.address.findFirst({
        where: { userId, kind: AddressKind.DRIVER_HOME, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.db.driverProfile.findUnique({
        where: { userId },
        select: { dateOfBirth: true },
      }),
      this.prisma.db.kycDocument.findMany({
        where: { userId },
        select: { type: true, reviewState: true, metadata: true },
      }),
    ]);

    const kycIdStatus = derivKycIdStatus(kycDocs);
    const kycSelfieStatus = derivSlotStatus(kycDocs, KycDocType.SELFIE);

    // Documents step: skipped for non-motorized; for motorized, requires
    // DRIVING_LICENSE + CARTE_GRISE per doc §4.3.
    let documentsStatus: StepStatus;
    if (!summary.vehicleType) {
      documentsStatus = 'incomplete';
    } else if (!MOTORIZED_VEHICLES.has(summary.vehicleType)) {
      documentsStatus = 'skipped';
    } else {
      const license = derivSlotStatus(kycDocs, KycDocType.DRIVING_LICENSE);
      const carteGrise = derivSlotStatus(kycDocs, KycDocType.CARTE_GRISE);
      documentsStatus = aggregateStepStatuses([license, carteGrise]);
    }

    // Driver vehicle step also captures DOB on the same screen — both
    // required to call it complete.
    const vehicleStatus: StepStatus =
      summary.vehicleType && driverProfile?.dateOfBirth ? 'complete' : 'incomplete';

    const charterStatus = await this.charterStatus(userId, [
      CharterKind.PUNCTUALITY,
      CharterKind.CARE,
    ]);

    const steps: Record<DriverStepKey, StepStatus> = {
      addresses: baseAddress ? 'complete' : 'incomplete',
      vehicle: vehicleStatus,
      zones: summary.zoneCount > 0 ? 'complete' : 'incomplete',
      kyc_id: kycIdStatus,
      kyc_selfie: kycSelfieStatus,
      documents: documentsStatus,
      charter: charterStatus,
    };

    const allDone = Object.values(steps).every(
      (s) => s === 'complete' || s === 'skipped',
    );
    const canDeliver = allDone && summary.kycStatus === KycStatus.APPROVED;

    return {
      role: 'DRIVER',
      next: firstIncomplete(DRIVER_ORDER, steps),
      steps,
      kycReviewState: summary.kycStatus,
      canDeliver,
    };
  }

  // -------------------- helpers --------------------

  private async charterStatus(
    userId: string,
    required: CharterKind[],
  ): Promise<StepStatus> {
    if (required.length === 0) return 'complete';
    const rows = await this.prisma.db.userCharter.findMany({
      where: {
        userId,
        OR: required.map((charter) => ({
          charter,
          version: ACTIVE_CHARTER_VERSIONS[charter],
        })),
      },
      select: { charter: true },
    });
    const accepted = new Set(rows.map((r) => r.charter));
    return required.every((c) => accepted.has(c)) ? 'complete' : 'incomplete';
  }
}

// -------------------- pure helpers --------------------

function firstIncomplete<K extends string>(
  order: readonly K[],
  steps: Record<K, StepStatus>,
): K | null {
  for (const step of order) {
    if (steps[step] === 'incomplete') return step;
  }
  return null;
}

/**
 * Status of a single KycDocument slot. Missing or REJECTED → incomplete
 * (user needs to upload). PENDING → pending_review. APPROVED → complete.
 */
function derivSlotStatus(
  docs: Array<{ type: KycDocType; reviewState: KycStatus }>,
  slot: KycDocType,
): StepStatus {
  const doc = docs.find((d) => d.type === slot);
  if (!doc || doc.reviewState === KycStatus.REJECTED) return 'incomplete';
  if (doc.reviewState === KycStatus.PENDING) return 'pending_review';
  return 'complete';
}

/**
 * KYC ID step needs ID_FRONT plus ID_BACK if the chosen document type
 * requires verso (CARTE_IDENTITE / TITRE_SEJOUR). The id-document type
 * is stashed in metadata on the ID_FRONT row by KycDocumentsService.
 */
function derivKycIdStatus(
  docs: Array<{ type: KycDocType; reviewState: KycStatus; metadata: unknown }>,
): StepStatus {
  const front = docs.find((d) => d.type === KycDocType.ID_FRONT);
  if (!front || front.reviewState === KycStatus.REJECTED) return 'incomplete';

  const idDocType = readIdDocumentType(front.metadata);
  const requiresVerso =
    idDocType !== null && ID_DOCUMENT_TYPES_REQUIRING_VERSO.has(idDocType);

  const slots: StepStatus[] = [
    front.reviewState === KycStatus.PENDING ? 'pending_review' : 'complete',
  ];
  if (requiresVerso) {
    const back = docs.find((d) => d.type === KycDocType.ID_BACK);
    if (!back || back.reviewState === KycStatus.REJECTED) return 'incomplete';
    slots.push(back.reviewState === KycStatus.PENDING ? 'pending_review' : 'complete');
  }
  return aggregateStepStatuses(slots);
}

function readIdDocumentType(metadata: unknown): IdDocumentType | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as { idDocumentType?: unknown }).idDocumentType;
  if (typeof value !== 'string') return null;
  const set = new Set<string>(Object.values(IdDocumentType));
  return set.has(value) ? (value as IdDocumentType) : null;
}

/** Aggregate status of multiple slots that make up one step. */
function aggregateStepStatuses(slots: StepStatus[]): StepStatus {
  if (slots.some((s) => s === 'incomplete')) return 'incomplete';
  if (slots.some((s) => s === 'pending_review')) return 'pending_review';
  return 'complete';
}
