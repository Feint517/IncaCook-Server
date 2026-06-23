import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OrderStatus } from '@common/enums/order-status.enum';
import {
  RATING_CRITERION_VALUE_TYPE,
  RatingCriterion,
  RatingValueType,
} from '@common/enums/rating-criterion.enum';
import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { StrikesService } from '@modules/strikes/strikes.service';

import { CreateReviewCriterionDto } from './dto/create-review-criterion.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { CriterionRatingAggregate, SellerStatsResponseDto } from './dto/seller-stats-response.dto';

import type { Review, ReviewCriterionRating, User } from '@prisma/client';

type ReviewWithRelations = Review & {
  author: User;
  criteriaRatings: ReviewCriterionRating[];
};

type Tx = Prisma.TransactionClient;

/**
 * Rating-based seller suspension: a seller with at least RATING_MIN_REVIEWS
 * whose average drops below RATING_SUSPENSION_THRESHOLD is suspended.
 */
const RATING_SUSPENSION_THRESHOLD = 3.5;
const RATING_MIN_REVIEWS = 10;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly strikes: StrikesService,
  ) {}

  /**
   * Buyer creates a review for a delivered order. Atomic with:
   *   - criterion-rating inserts
   *   - SellerProfile.averageRating + reviewCount recompute
   *
   * Eligibility: order exists, buyer matches the JWT user, status is
   * DELIVERED, no existing review on this order. Order's UNIQUE FK on
   * Review.orderId is the last line of defense against double-reviews
   * (raced clicks).
   */
  async createForOrder(
    supabaseId: string,
    orderId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewWithRelations> {
    const author = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!author) {
      throw new NotFoundException('User profile not found');
    }

    const order = await this.prisma.db.order.findUnique({
      where: { id: orderId },
      select: { id: true, buyerId: true, sellerId: true, status: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.buyerId !== author.id) {
      throw new ForbiddenException('You can only review your own orders');
    }
    if (order.status !== OrderStatus.Delivered) {
      throw new BadRequestException(
        `Order must be in DELIVERED status to leave a review (currently ${order.status})`,
      );
    }

    const existing = await this.prisma.db.review.findUnique({
      where: { orderId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Order already reviewed');
    }

    if (dto.criteriaRatings) {
      validateCriteriaValues(dto.criteriaRatings);
    }

    const reviewId = generateUlid();
    const sellerId = order.sellerId;

    await this.prisma.$transaction(async (tx) => {
      await tx.review.create({
        data: {
          id: reviewId,
          orderId,
          authorId: author.id,
          sellerId,
          rating: dto.rating,
          body: dto.body,
        },
      });

      if (dto.criteriaRatings && dto.criteriaRatings.length > 0) {
        await tx.reviewCriterionRating.createMany({
          data: dto.criteriaRatings.map((c) => ({
            reviewId,
            criterion: c.criterion,
            value: new Prisma.Decimal(c.value),
            sampleCount: c.sampleCount ?? 1,
          })),
        });
      }

      await this.recomputeSellerAggregates(tx, sellerId);
    });

    // After the aggregates are committed, re-check the rating-suspension rule.
    // Best-effort — a suspension-eval failure must not fail the review.
    try {
      await this.evaluateSellerRatingSuspension(sellerId);
    } catch (err) {
      this.logger.error(
        `[SellerRating] evaluation failed sellerId=${sellerId}: ${(err as Error).message}`,
      );
    }

    const review = await this.prisma.db.review.findUnique({
      where: { id: reviewId },
      include: { author: true, criteriaRatings: true },
    });
    // Just inserted in the same logical operation — guaranteed to exist.
    return review!;
  }

  /**
   * Suspends the seller when their average rating drops below
   * RATING_SUSPENSION_THRESHOLD over at least RATING_MIN_REVIEWS reviews.
   * Idempotent: a seller already suspended is left untouched (no duplicate
   * action or notification). Existing `User.isSuspended` protections then hide
   * them from the buyer feed and block new orders.
   */
  async evaluateSellerRatingSuspension(sellerId: string): Promise<void> {
    const agg = await this.prisma.db.review.aggregate({
      where: { sellerId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const count = agg._count._all;
    const average = agg._avg.rating !== null ? Number(agg._avg.rating) : null;

    if (count < RATING_MIN_REVIEWS || average === null || average >= RATING_SUSPENSION_THRESHOLD) {
      return;
    }

    const user = await this.prisma.db.user.findUnique({
      where: { id: sellerId },
      select: { isSuspended: true },
    });
    if (!user || user.isSuspended) return; // idempotent — already suspended

    await this.strikes.suspendUser(
      sellerId,
      'SELLER',
      'Note vendeur inférieure à 3,5/5 avec au moins 10 avis',
      {
        message: 'Votre compte vendeur est suspendu car votre note moyenne est inférieure à 3,5/5.',
      },
    );
    this.logger.log(
      `[SellerRating] suspended sellerId=${sellerId} average=${average} count=${count}`,
    );
  }

  /**
   * Computes the full SellerStats bundle on demand. Cheap at v1 scale —
   * 4-5 small aggregations against indexed columns. If review counts grow
   * we can materialize this into a `seller_stats` table refreshed on
   * cron, or a Postgres materialized view as the doc allows.
   *
   * Stubbed for v1:
   *   - responseRatePercent: needs Order data + SLA definition
   *   - sentimentTags: needs NLP on review bodies
   */
  async getSellerStats(sellerId: string): Promise<SellerStatsResponseDto> {
    const seller = await this.prisma.db.sellerProfile.findUnique({
      where: { userId: sellerId },
      select: {
        userId: true,
        averageRating: true,
        reviewCount: true,
      },
    });
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }

    const [mealsSold, mealsSaved, distribution, criteria] = await Promise.all([
      // Doc says "completed orders" — DELIVERED + COMPLETED both count as a
      // sold meal from the buyer's perspective.
      this.prisma.db.order.count({
        where: {
          sellerId,
          status: { in: [OrderStatus.Delivered, OrderStatus.Completed] },
        },
      }),
      this.prisma.db.bookmark.count({
        where: { listing: { sellerId } },
      }),
      this.prisma.db.review.groupBy({
        by: ['rating'],
        where: { sellerId },
        _count: { _all: true },
      }),
      this.prisma.db.reviewCriterionRating.groupBy({
        by: ['criterion'],
        where: { review: { sellerId } },
        _avg: { value: true },
        _sum: { sampleCount: true },
      }),
    ]);

    const ratingDistribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const row of distribution) {
      ratingDistribution[String(row.rating)] = row._count._all;
    }

    const criteriaRatings: CriterionRatingAggregate[] = criteria.map((row) => ({
      criterion: row.criterion as RatingCriterion,
      avgValue: row._avg.value !== null ? Number(row._avg.value) : 0,
      sampleCount: row._sum.sampleCount ?? 0,
    }));

    return {
      sellerId: seller.userId,
      rating: seller.averageRating,
      reviewCount: seller.reviewCount,
      mealsSold,
      mealsSaved,
      responseRatePercent: null,
      ratingDistribution,
      sentimentTags: [],
      criteriaRatings,
    };
  }

  /** Paginated list of a seller's reviews, newest first. */
  async listForSeller(
    sellerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: ReviewWithRelations[]; hasMore: boolean }> {
    const rows = await this.prisma.db.review.findMany({
      where: { sellerId },
      include: { author: true, criteriaRatings: true },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      skip: offset,
    });
    const hasMore = rows.length > limit;
    return {
      items: hasMore ? rows.slice(0, limit) : rows,
      hasMore,
    };
  }

  // ---------- helpers ----------

  /**
   * Recomputes SellerProfile.averageRating and reviewCount from the
   * reviews table. Cheap on small tables; revisit if review counts
   * grow large — could switch to incremental updates (delta the cached
   * count + running mean).
   */
  private async recomputeSellerAggregates(tx: Tx, sellerId: string): Promise<void> {
    const agg = await tx.review.aggregate({
      where: { sellerId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await tx.sellerProfile.update({
      where: { userId: sellerId },
      data: {
        averageRating: agg._avg.rating ?? null,
        reviewCount: agg._count._all,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateCriteriaValues(ratings: CreateReviewCriterionDto[]): void {
  for (const r of ratings) {
    const valueType = RATING_CRITERION_VALUE_TYPE[r.criterion as RatingCriterion];
    if (valueType === RatingValueType.Score5 && (r.value < 0 || r.value > 5)) {
      throw new BadRequestException(`Criterion ${r.criterion} expects a score 0–5; got ${r.value}`);
    }
    // Percent criteria (hygiene) are BINARY per the client spec: 0 or 100,
    // nothing in between (e.g. 47.5 / 50 are rejected).
    if (valueType === RatingValueType.Percent && r.value !== 0 && r.value !== 100) {
      throw new BadRequestException(
        `Criterion ${r.criterion} is binary — expects 0 or 100; got ${r.value}`,
      );
    }
  }
}
