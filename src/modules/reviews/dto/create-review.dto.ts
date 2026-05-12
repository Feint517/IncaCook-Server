import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CreateReviewCriterionDto } from './create-review-criterion.dto';

/**
 * Body for `POST /v1/orders/:orderId/review`. Identity (the buyer) is
 * resolved from the JWT — never accepted from the body. The order id
 * comes from the URL.
 */
export class CreateReviewDto {
  /** 1–5 stars. DB CHECK constraint enforces this too. */
  @IsInt() @Min(1) @Max(5)
  rating!: number;

  @IsString() @MinLength(1) @MaxLength(2000)
  body!: string;

  /**
   * Optional sub-ratings. Service deduplicates by criterion (you can rate
   * each criterion at most once per review). The criteria-rating PK
   * `(reviewId, criterion)` enforces this at the DB layer too.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique((c: CreateReviewCriterionDto) => c.criterion)
  @ValidateNested({ each: true })
  @Type(() => CreateReviewCriterionDto)
  criteriaRatings?: CreateReviewCriterionDto[];
}
