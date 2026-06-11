import { SellerCategory } from '@common/enums/seller-category.enum';

/**
 * Category-specific maximum search / delivery radius in km (client spec):
 *   - Traiteur (L'Atelier Traiteur) reaches up to 50 km.
 *   - Fait-maison (Le Bon Fait Maison) + Restaurant (Sauve Ton Panier) stay
 *     local at 10 km.
 *
 * Mirrors the Flutter `SellerCategory.maxRadiusKm` so the backend is the
 * source of truth — the slider is only a UI convenience, never the enforcer.
 */
export const CATEGORY_MAX_RADIUS_KM: Readonly<Record<SellerCategory, number>> = {
  [SellerCategory.FaitMaison]: 10,
  [SellerCategory.Traiteur]: 50,
  [SellerCategory.Restaurant]: 10,
};

/**
 * Cap applied to a feed query with no category filter (mixed feed). Matches
 * the Flutter `ListingFilter.standardRadiusKm` (10 km) — the common local
 * case. A buyer targeting distant Traiteurs filters by category, which raises
 * the cap to 50. Keeps the 500 km DTO ceiling from being used for an
 * unfiltered search.
 */
export const DEFAULT_MAX_RADIUS_KM = 10;

/**
 * Resolved max radius (km) for a given category (or the default when none).
 * Accepts a string so it works with both the `@common` and Prisma-generated
 * `SellerCategory` enums (identical string values, distinct TS types).
 */
export function maxRadiusForCategory(category?: string | null): number {
  if (!category) return DEFAULT_MAX_RADIUS_KM;
  return CATEGORY_MAX_RADIUS_KM[category as SellerCategory] ?? DEFAULT_MAX_RADIUS_KM;
}
