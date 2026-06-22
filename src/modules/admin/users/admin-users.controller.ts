import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import { RolesGuard } from '@common/guards/roles.guard';

import { AdminUsersService } from './admin-users.service';

/** Read-only admin user lookup for the sanctions UI. Admin/Moderator only. */
@Controller({ version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  /** `GET /v1/admin/users?search=&limit=&offset=` — search/list users. */
  @Get('admin/users')
  async list(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = Math.max(Number(offset) || 0, 0);
    return this.users.search(search, take, skip);
  }

  /** `GET /v1/admin/users/:id` — one user. */
  @Get('admin/users/:id')
  async byId(@Param('id') id: string) {
    return this.users.getById(id);
  }
}
