import { RatingCriterion } from '@common/enums/rating-criterion.enum';

export interface CriterionRatingAggregate {
  criterion: RatingCriterion;
  avgValue: number;
  sampleCount: number;
}

export interface SentimentTag {
  label: string;
  count: number;
}

/**
 * Public-facing aggregate bundle for `GET /v1/sellers/:sellerId/stats`.
 *
 * `responseRatePercent` and `sentimentTags` are stubbed for v1 — they need
 * orders + SLA definitions and NLP respectively. Returned as null/[] so the
 * Flutter app's UI doesn't have to handle "missing field" cases.
 */
export class SellerStatsResponseDto {
  sellerId!: string;
  rating!: number | null;
  reviewCount!: number;
  mealsSold!: number;
  mealsSaved!: number;
  responseRatePercent!: number | null;
  /** Map keyed by stars 1..5: `{ "5": 12, "4": 3, ... }`. Missing keys = 0. */
  ratingDistribution!: Record<string, number>;
  sentimentTags!: SentimentTag[];
  criteriaRatings!: CriterionRatingAggregate[];
}
