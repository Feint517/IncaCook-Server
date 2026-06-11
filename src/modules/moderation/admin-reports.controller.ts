import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { ListReportsQueryDto } from './dto/list-reports.query.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { ReportsService } from './reports.service';

@Controller({ path: 'admin/reports', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Paginated reports (newest first); filter by `status` / `type`. */
  @Get()
  async list(@Query() query: ListReportsQueryDto) {
    return this.reports.list(query);
  }

  /** Resolve or reject a report (optional adminNote). */
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateReportStatusDto,
  ): Promise<{ id: string; status: string }> {
    return this.reports.updateStatus(id, dto, jwtUser.id);
  }
}
