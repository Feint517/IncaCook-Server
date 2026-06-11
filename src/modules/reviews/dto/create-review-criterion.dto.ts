import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

import { RatingCriterion } from '@common/enums/rating-criterion.enum';

/**
 * Sub-rating attached to a review. The criterion's `value_type` is fixed
 * (RATING_CRITERION_VALUE_TYPE) — the service rejects out-of-range values.
 */
export class CreateReviewCriterionDto {
  @IsEnum(RatingCriterion)
  criterion!: RatingCriterion;

  // Bounds enforced per-criterion in the service. 0–5 for score5, 0–100 for percent.
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  value!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  sampleCount?: number;
}
