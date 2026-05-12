import type { SellerProfile } from '@prisma/client';

import { CuisineType } from '@common/enums/cuisine-type.enum';
import { DishType } from '@common/enums/dish-type.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';

import { AddressResponseDto } from './address-response.dto';
import { OpeningHoursResponseDto } from './opening-hours-response.dto';

export class SellerProfileResponseDto {
  category!: SellerCategory;
  displayName!: string;
  bio!: string | null;
  profilePhotoUrl!: string;
  dateOfBirth!: string; // ISO date YYYY-MM-DD

  pickupAddress!: AddressResponseDto;

  businessName!: string | null;
  siret!: string | null;
  restaurantFacadeUrl!: string | null;

  cuisineTypes!: CuisineType[];
  dishTypes!: DishType[];

  hygieneCommitment!: boolean;
  faitMaisonCommitment!: boolean;

  deliveryRadiusKm!: number;
  deliveryFeeCents!: number;

  prepMinMinutes!: number;
  prepMaxMinutes!: number;

  neighborhood!: string;
  languageCodes!: string[];

  availabilitySchedule!: string | null;
  verifications!: string[];
  promoText!: string | null;
  categoryTag!: string | null;

  kycStatus!: KycStatus;
  // Drives post-login UX: if false, prompt the seller to complete Stripe
  // Express onboarding before they can receive payouts.
  stripeOnboardingCompleted!: boolean;

  openingHours!: OpeningHoursResponseDto[];

  static from(
    profile: SellerProfile,
    pickupAddress: AddressResponseDto,
    openingHours: OpeningHoursResponseDto[],
  ): SellerProfileResponseDto {
    return {
      category: profile.category as SellerCategory,
      displayName: profile.displayName,
      bio: profile.bio,
      profilePhotoUrl: profile.profilePhotoUrl,
      dateOfBirth: profile.dateOfBirth.toISOString().slice(0, 10),
      pickupAddress,
      businessName: profile.businessName,
      siret: profile.siret,
      restaurantFacadeUrl: profile.restaurantFacadeUrl,
      cuisineTypes: profile.cuisineTypes as CuisineType[],
      dishTypes: profile.dishTypes as DishType[],
      hygieneCommitment: profile.hygieneCommitment,
      faitMaisonCommitment: profile.faitMaisonCommitment,
      deliveryRadiusKm: Number(profile.deliveryRadiusKm),
      deliveryFeeCents: profile.deliveryFeeCents,
      prepMinMinutes: profile.prepMinMinutes,
      prepMaxMinutes: profile.prepMaxMinutes,
      neighborhood: profile.neighborhood,
      languageCodes: profile.languageCodes,
      availabilitySchedule: profile.availabilitySchedule,
      verifications: profile.verifications,
      promoText: profile.promoText,
      categoryTag: profile.categoryTag,
      kycStatus: profile.kycStatus as KycStatus,
      stripeOnboardingCompleted: profile.stripeOnboardingCompleted,
      openingHours,
    };
  }
}
