import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { CreateKycSubmissionDto } from './dto/create-kyc-submission.dto';
import { KycSubmissionResponseDto } from './dto/kyc-submission-response.dto';
import { KycSubmissionsService } from './kyc-submissions.service';

@Controller({ path: 'kyc-submissions', version: '1' })
export class KycSubmissionsController {
  constructor(private readonly kyc: KycSubmissionsService) {}

  /**
   * Submits (or resubmits) KYC documents. Each call creates a new row,
   * preserving the audit trail. The most recent submission is the current
   * one; admin review acts on it.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: CreateKycSubmissionDto,
  ): Promise<KycSubmissionResponseDto> {
    const submission = await this.kyc.submit(jwtUser.id, dto);
    return KycSubmissionResponseDto.from(submission);
  }

  /** Returns the current user's most recent submission. */
  @Get('me')
  async me(@CurrentUser() jwtUser: AuthenticatedUser): Promise<KycSubmissionResponseDto> {
    const submission = await this.kyc.findLatestForUser(jwtUser.id);
    return KycSubmissionResponseDto.from(submission);
  }
}
