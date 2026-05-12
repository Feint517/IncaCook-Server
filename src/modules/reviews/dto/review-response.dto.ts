import type { Review, ReviewCriterionRating, User } from '@prisma/client';

import { RatingCriterion } from '@common/enums/rating-criterion.enum';

export class ReviewCriterionResponseDto {
  criterion!: RatingCriterion;
  value!: number;
  sampleCount!: number;

  static from(row: ReviewCriterionRating): ReviewCriterionResponseDto {
    return {
      criterion: row.criterion as RatingCriterion,
      value: Number(row.value),
      sampleCount: row.sampleCount,
    };
  }
}

export class ReviewResponseDto {
  id!: string;
  orderId!: string;
  sellerId!: string;
  rating!: number;
  body!: string;
  helpfulCount!: number;
  createdAt!: Date;
  author!: {
    id: string;
    firstName: string;
    lastName: string;
    avatarPath: string | null;
  };
  criteriaRatings!: ReviewCriterionResponseDto[];

  static from(
    review: Review & {
      author: User;
      criteriaRatings: ReviewCriterionRating[];
    },
  ): ReviewResponseDto {
    return {
      id: review.id,
      orderId: review.orderId,
      sellerId: review.sellerId,
      rating: review.rating,
      body: review.body,
      helpfulCount: review.helpfulCount,
      createdAt: review.createdAt,
      author: {
        id: review.author.id,
        firstName: review.author.firstName,
        lastName: review.author.lastName,
        avatarPath: review.author.avatarPath,
      },
      criteriaRatings: review.criteriaRatings.map((c) =>
        ReviewCriterionResponseDto.from(c),
      ),
    };
  }
}

export class ReviewListResponseDto {
  items!: ReviewResponseDto[];
  limit!: number;
  offset!: number;
  hasMore!: boolean;
}
