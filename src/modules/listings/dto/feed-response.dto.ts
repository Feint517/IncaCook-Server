import { FeedListingResponseDto } from './feed-listing-response.dto';

/**
 * Envelope for `GET /v1/listings`. Offset-based pagination with `hasMore`
 * (server fetches `limit + 1` and trims). No total count — keeps the query
 * cheap on large catalogs and matches infinite-scroll mobile UX.
 */
export class FeedResponseDto {
  items!: FeedListingResponseDto[];
  limit!: number;
  offset!: number;
  hasMore!: boolean;
}
