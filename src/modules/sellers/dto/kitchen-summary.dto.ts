import { KycStatus } from '@prisma/client';

import type { SellerCuisine, SellerProfile } from '@prisma/client';

type SellerWithCuisines = SellerProfile & { cuisines: SellerCuisine[] };

/**
 * Buyer-facing "kitchen" card for the home feed (`GET /v1/sellers`). Image
 * fields are raw storage paths — the client resolves them to public URLs via
 * `ApiConstants.publicImageUrl`, same as listing images.
 */
export class KitchenSummaryDto {
  id!: string;
  name!: string;
  imageUrl!: string;
  chefImageUrl!: string;
  rating!: number;
  reviewCount!: number;
  isVerified!: boolean;
  hasFreeDelivery!: boolean;
  deliveryTime!: string;
  tags!: string[];

  static from(s: SellerWithCuisines): KitchenSummaryDto {
    const prep =
      s.prepMinMinutes != null && s.prepMaxMinutes != null
        ? `${s.prepMinMinutes}-${s.prepMaxMinutes} min`
        : '';
    return {
      id: s.userId,
      name: s.displayName ?? '',
      imageUrl: s.profilePhotoUrl ?? '',
      // SellerProfile carries a single photo today; reuse it for both the
      // cover and the chef avatar until a dedicated cover image exists.
      chefImageUrl: s.profilePhotoUrl ?? '',
      rating: s.averageRating ?? 0,
      reviewCount: s.reviewCount,
      isVerified: s.kycStatus === KycStatus.APPROVED,
      hasFreeDelivery: s.deliveryFeeCents === 0,
      deliveryTime: prep,
      tags: s.cuisines.map((c) => c.cuisineType),
    };
  }
}
