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

import { AdminKycDocumentsService } from './admin-kyc-documents.service';
import {
  AdminKycDocumentListItemDto,
  AdminKycDocumentListResponseDto,
  AdminKycDocumentResponseDto,
} from './dto/admin-kyc-document-response.dto';
import { ListAdminKycDocumentsQueryDto } from './dto/list-admin-kyc-documents.query.dto';
import { RejectKycDocumentDto } from './dto/reject-kyc-document.dto';

@Controller({ path: 'admin/kyc/documents', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminKycDocumentsController {
  constructor(private readonly admin: AdminKycDocumentsService) {}

  /**
   * Review queue. Defaults to PENDING (oldest first) — that's the FIFO
   * queue admins work through. Pass `?reviewState=APPROVED|REJECTED` for
   * history, or `?type=ID_FRONT` to focus on one slot.
   */
  @Get()
  async list(
    @Query() query: ListAdminKycDocumentsQueryDto,
  ): Promise<AdminKycDocumentListResponseDto> {
    const result = await this.admin.list(query);
    return {
      items: result.items.map((d) => AdminKycDocumentListItemDto.from(d)),
      limit: result.limit,
      offset: result.offset,
      hasMore: result.hasMore,
    };
  }

  /** Detail view with the document's signed Storage URL (15-min TTL). */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<AdminKycDocumentResponseDto> {
    const { document, signedFileUrl } = await this.admin.findById(id);
    return AdminKycDocumentResponseDto.from(document, signedFileUrl);
  }

  /**
   * Approves one document. The user's role-profile kycStatus is recomputed
   * from the aggregate state of all their documents.
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ id: string; reviewState: string }> {
    const doc = await this.admin.approve(id, jwtUser.id);
    return { id: doc.id, reviewState: doc.reviewState };
  }

  /**
   * Rejects one document with a user-facing reason. The user can re-upload
   * to the same slot; that resets their profile back to PENDING.
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectKycDocumentDto,
  ): Promise<{ id: string; reviewState: string }> {
    const doc = await this.admin.reject(id, jwtUser.id, dto.rejectionReason);
    return { id: doc.id, reviewState: doc.reviewState };
  }
}
