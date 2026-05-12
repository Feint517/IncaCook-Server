import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { AdminKycService } from './admin-kyc.service';
import {
  AdminKycListResponseDto,
  AdminKycSubmissionListItemDto,
  AdminKycSubmissionResponseDto,
} from './dto/admin-kyc-submission-response.dto';
import { ListAdminKycQueryDto } from './dto/list-admin-kyc.query.dto';
import { RejectKycSubmissionDto } from './dto/reject-kyc-submission.dto';

@Controller({ path: 'admin/kyc-submissions', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminKycController {
  constructor(private readonly admin: AdminKycService) {}

  /**
   * Review queue. Defaults to PENDING (oldest first) — that's the FIFO
   * queue admins work through. Pass `?status=APPROVED` or `REJECTED` to
   * see history.
   */
  @Get()
  async list(@Query() query: ListAdminKycQueryDto): Promise<AdminKycListResponseDto> {
    const result = await this.admin.list(query);
    return {
      items: result.items.map((s) => AdminKycSubmissionListItemDto.from(s)),
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
    };
  }

  /** Detail view with signed (15-min TTL) URLs for each KYC document. */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<AdminKycSubmissionResponseDto> {
    const { submission, signed } = await this.admin.findById(id);
    return AdminKycSubmissionResponseDto.from(submission, signed);
  }

  /**
   * Approves the submission. Cascades the APPROVED status onto the
   * submitter's role profile (seller_profiles or driver_profiles). Logs
   * to AuditLog.
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ id: string; status: string }> {
    const submission = await this.admin.approve(id, jwtUser.id);
    return { id: submission.id, status: submission.status };
  }

  /**
   * Rejects the submission with a user-facing reason. Cascades to role
   * profile.kycStatus = REJECTED. Submitter can resubmit; their next
   * submission resets profile back to PENDING (handled in
   * KycSubmissionsService).
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectKycSubmissionDto,
  ): Promise<{ id: string; status: string }> {
    const submission = await this.admin.reject(id, jwtUser.id, dto.rejectionReason);
    return { id: submission.id, status: submission.status };
  }
}
