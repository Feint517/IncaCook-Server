import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { CreateLegalDocumentDto } from './dto/create-legal-document.dto';
import { UpdateLegalDocumentDto } from './dto/update-legal-document.dto';
import { LegalDocumentsService, LegalDocumentView } from './legal-documents.service';

/** Admin management of CGU/CGV documents: list, view active, create/edit drafts,
 *  and publish (which notifies every user). Admin or Moderator only. */
@Controller({ path: 'admin/legal-documents', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminLegalDocumentsController {
  constructor(private readonly service: LegalDocumentsService) {}

  @Get()
  list(): Promise<LegalDocumentView[]> {
    return this.service.list();
  }

  @Get('active')
  active(): Promise<LegalDocumentView[]> {
    return this.service.activeAll();
  }

  @Post()
  create(
    @Body() dto: CreateLegalDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegalDocumentView> {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLegalDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegalDocumentView> {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LegalDocumentView> {
    return this.service.publish(id, user.id);
  }
}
