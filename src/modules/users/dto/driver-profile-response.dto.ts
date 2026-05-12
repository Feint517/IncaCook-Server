import type { DriverProfile } from '@prisma/client';

import { DriverVehicleType } from '@common/enums/driver-vehicle-type.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';

import { AddressResponseDto } from './address-response.dto';

/** Returned to the driver themselves on `GET /v1/users/me`. */
export class DriverProfileResponseDto {
  dateOfBirth!: string; // YYYY-MM-DD
  baseAddress!: AddressResponseDto;
  vehicleType!: DriverVehicleType;
  operatingZones!: string[];
  charterAccepted!: boolean;
  punctualityCommitment!: boolean;
  careCommitment!: boolean;
  kycStatus!: KycStatus;
  // Drives the post-login UX: if false, prompt the driver to complete
  // Stripe Express onboarding before they can accept paid jobs.
  stripeOnboardingCompleted!: boolean;
  isOnline!: boolean;
  averageRating!: number | null;
  totalDeliveries!: number;

  static from(
    profile: DriverProfile,
    baseAddress: AddressResponseDto,
  ): DriverProfileResponseDto {
    return {
      dateOfBirth: profile.dateOfBirth.toISOString().slice(0, 10),
      baseAddress,
      vehicleType: profile.vehicleType as DriverVehicleType,
      operatingZones: profile.operatingZones,
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
