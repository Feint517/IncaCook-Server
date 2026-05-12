import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { KycDocumentResponseDto } from './dto/kyc-document-response.dto';
import { UpsertKycDocumentDto } from './dto/upsert-kyc-document.dto';
import { KycDocumentsService } from './kyc-documents.service';

@Controller({ path: 'kyc/documents', version: '1' })
export class KycDocumentsController {
  constructor(private readonly kyc: KycDocumentsService) {}

  /**
   * Upserts one KYC document. Calling again with the same `type` replaces
   * the file URL and resets review to PENDING.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async upsert(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: UpsertKycDocumentDto,
  ): Promise<KycDocumentResponseDto> {
    const doc = await this.kyc.upsert(jwtUser.id, dto);
    return KycDocumentResponseDto.from(doc);
  }

  /** Lists the caller's KYC documents — one row per type. */
  @Get('me')
  async me(@CurrentUser() jwtUser: AuthenticatedUser): Promise<KycDocumentResponseDto[]> {
    const docs = await this.kyc.listForUser(jwtUser.id);
    return docs.map((d) => KycDocumentResponseDto.from(d));
  }
}
