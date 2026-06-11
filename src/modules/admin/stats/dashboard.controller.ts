import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import { RolesGuard } from '@common/guards/roles.guard';

import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

/**
 * Admin dashboard statistics — all real DB aggregations. ADMIN only
 * (global JWT guard + RolesGuard). Every endpoint accepts the shared date
 * filter (`?range=today|last7Days|last30Days|all` or `?dateFrom&dateTo`).
 */
@Controller({ path: 'admin/dashboard', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Headline KPIs (users, listings, orders, revenue, recurring/mono). */
  @Get('overview')
  overview(@Query() q: DashboardQueryDto) {
    return this.dashboard.overview(q);
  }

  /** User counts by role + recurring/mono counts. */
  @Get('users')
  users(@Query() q: DashboardQueryDto) {
    return this.dashboard.userStats(q);
  }

  /** Revenue totals + breakdown by category and city. */
  @Get('revenue')
  revenue(@Query() q: DashboardQueryDto) {
    return this.dashboard.revenueSummary(q);
  }

  /** Paid revenue grouped by seller category. */
  @Get('categories')
  categories(@Query() q: DashboardQueryDto) {
    return this.dashboard.revenueByCategory(q);
  }

  /** Paid revenue grouped by delivery (dropoff) city. */
  @Get('cities')
  cities(@Query() q: DashboardQueryDto) {
    return this.dashboard.revenueByCity(q);
  }

  /** Recurring users (≥2 paid transactions in the last 7 days). */
  @Get('recurring-users')
  async recurringUsers() {
    const userIds = await this.dashboard.recurringUserIds();
    return { count: userIds.length, userIds };
  }

  /** Mono users (exactly one paid transaction). */
  @Get('mono-users')
  async monoUsers() {
    const userIds = await this.dashboard.monoUserIds();
    return { count: userIds.length, userIds };
  }
}
