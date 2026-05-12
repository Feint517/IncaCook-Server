import type {
  SellerBusiness,
  SellerCuisine,
  SellerDish,
  SellerOpeningHours,
  SellerProfile,
} from '@prisma/client';

import { CuisineType } from '@common/enums/cuisine-type.enum';
import { DishType } from '@common/enums/dish-type.enum';
import { KycStatus } from '@common/enums/kyc-status.enum';
import { SellerCategory } from '@common/enums/seller-category.enum';

import { AddressResponseDto } from './address-response.dto';
import { OpeningHoursResponseDto } from './opening-hours-response.dto';

/**
 * Seller profile as seen on /v1/users/me. After Phase A all signup-time
 * fields are nullable — the wizard fills them in via Phase B endpoints.
 * Flutter's `OnboardingState` model treats null fields as "step not yet
 * completed" and routes the user to the matching wizard screen.
 */
export class SellerProfileResponseDto {
  category!: SellerCategory | null;
  displayName!: string | null;
  bio!: string | null;
  profilePhotoUrl!: string | null;
  dateOfBirth!: string | null; // ISO date YYYY-MM-DD

  pickupAddress!: AddressResponseDto | null;

  businessName!: string | null;
  siret!: string | null;
  facadeUrl!: string | null;

  cuisineTypes!: CuisineType[];
  dishTypes!: DishType[];

  hygieneCommitment!: boolean | null;
  faitMaisonCommitment!: boolean | null;

  deliveryRadiusKm!: number | null;
  deliveryFeeCents!: number | null;

  prepMinMinutes!: number | null;
  prepMaxMinutes!: number | null;

  neighborhood!: string | null;
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
    profile: SellerProfile & {
      business: (SellerBusiness & { openingHours: SellerOpeningHours[] }) | null;
      cuisines: SellerCuisine[];
      dishes: SellerDish[];
    },
    pickupAddress: AddressResponseDto | null,
    openingHours: OpeningHoursResponseDto[],
  ): SellerProfileResponseDto {
    return {
      category: profile.category as SellerCategory | null,
      displayName: profile.displayName,
      bio: profile.bio,
      profilePhotoUrl: profile.profilePhotoUrl,
      dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      pickupAddress,
      businessName: profile.business?.businessName ?? null,
      siret: profile.business?.siret ?? null,
      facadeUrl: profile.business?.facadeUrl ?? null,
      cuisineTypes: profile.cuisines.map((c) => c.cuisineType as CuisineType),
      dishTypes: profile.dishes.map((d) => d.dishType as DishType),
      hygieneCommitment: profile.hygieneCommitment,
      faitMaisonCommitment: profile.faitMaisonCommitment,
      deliveryRadiusKm: profile.deliveryRadiusKm !== null ? Number(profile.deliveryRadiusKm) : null,
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
