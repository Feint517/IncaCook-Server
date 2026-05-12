import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsQueryDto } from './dto/list-reviews.query.dto';
import {
  ReviewListResponseDto,
  ReviewResponseDto,
} from './dto/review-response.dto';
import { SellerStatsResponseDto } from './dto/seller-stats-response.dto';
import { ReviewsService } from './reviews.service';

@Controller({ version: '1' })
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /**
   * Buyer creates a review for a delivered order. One review per order
   * (UNIQUE FK on Review.orderId). Eligibility checks live in the service.
   */
  @Post('orders/:orderId/review')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    const review = await this.reviews.createForOrder(jwtUser.id, orderId, dto);
    return ReviewResponseDto.from(review);
  }

  /** Paginated list of a seller's reviews, newest first. */
  @Get('sellers/:sellerId/reviews')
  async listForSeller(
    @Param('sellerId') sellerId: string,
    @Query() query: ListReviewsQueryDto,
  ): Promise<ReviewListResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const result = await this.reviews.listForSeller(sellerId, limit, offset);
    return {
      items: result.items.map((r) => ReviewResponseDto.from(r)),
      limit,
      offset,
      hasMore: result.hasMore,
    };
  }

  /**
   * Aggregate stats for a seller — rating, review count, meals sold,
   * meals saved, distribution, criteria averages. Computed on demand;
   * see SellerStatsResponseDto for which fields are stubbed in v1.
   */
  @Get('sellers/:sellerId/stats')
  async getStats(@Param('sellerId') sellerId: string): Promise<SellerStatsResponseDto> {
    return this.reviews.getSellerStats(sellerId);
  }
}
