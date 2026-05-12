import { ListingResponseDto } from './listing-response.dto';

/**
 * Listing as it appears in the buyer feed. Inherits the full listing shape
 * and adds the four denormalized/aggregate fields the doc lists as buyer-side
 * additions:
 *
 *   - sellerName        (join from SellerProfile.displayName)
 *   - distanceKm        (PostGIS ST_Distance / 1000; null when no buyer point)
 *   - inRange           (distanceKm <= seller.deliveryRadiusKm; null when no
 *                        buyer point or distance unknown)
 *   - rating            (from seller_stats; null until reviews slice ships)
 *   - reviewCount       (from reviews; 0 until reviews slice ships)
 *
 * Add-ons are intentionally OMITTED from the feed response — they're loaded
 * lazily via `GET /v1/listings/:id` when the buyer taps in.
 */
export class FeedListingResponseDto extends ListingResponseDto {
  sellerName!: string;
  distanceKm!: number | null;
  inRange!: boolean | null;
  rating!: number | null;
  reviewCount!: number;
}
