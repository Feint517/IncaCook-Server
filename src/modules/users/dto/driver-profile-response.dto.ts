import type { DriverProfile } from '@prisma/client';

import { DriverVehicleType } from '@common/enums/driver-vehicle-type.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';

import { AddressResponseDto } from './address-response.dto';

/**
 * Returned to the driver themselves on `GET /v1/users/me`. After Phase A
 * all signup-time fields are nullable — the wizard fills them in via
 * Phase B PUT endpoints (vehicle, zones, base address, charters).
 */
export class DriverProfileResponseDto {
  dateOfBirth!: string | null; // YYYY-MM-DD
  baseAddress!: AddressResponseDto | null;
  vehicleType!: DriverVehicleType | null;
  operatingZones!: string[];
  charterAccepted!: boolean | null;
  punctualityCommitment!: boolean | null;
  careCommitment!: boolean | null;
  kycStatus!: KycStatus;
  stripeOnboardingCompleted!: boolean;
  isOnline!: boolean;
  averageRating!: number | null;
  totalDeliveries!: number;

  static from(
    profile: DriverProfile,
    baseAddress: AddressResponseDto | null,
    operatingZones: string[],
  ): DriverProfileResponseDto {
    return {
      dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      baseAddress,
      vehicleType: profile.vehicleType as DriverVehicleType | null,
      operatingZones,
      charterAccepted: profile.charterAccepted,
      punctualityCommitment: profile.punctualityCommitment,
      careCommitment: profile.careCommitment,
      kycStatus: profile.kycStatus as KycStatus,
      stripeOnboardingCompleted: profile.stripeOnboardingCompleted,
      isOnline: profile.isOnline,
      averageRating: profile.averageRating,
      totalDeliveries: profile.totalDeliveries,
    };
  }
}
