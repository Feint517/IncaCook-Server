import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Any authenticated user files a moderation report. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ): Promise<{ id: string; status: string }> {
    return this.reports.create(jwtUser.id, dto);
  }
}
