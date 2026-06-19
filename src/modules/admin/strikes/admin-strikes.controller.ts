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

import { StrikesService } from '@modules/strikes/strikes.service';

import { AddStrikeDto } from './dto/add-strike.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';

/** Admin/moderator strike + suspension management. */
@Controller({ version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminStrikesController {
  constructor(private readonly strikes: StrikesService) {}

  /** `GET /v1/admin/strikes?userId=...` — a user's strike history. */
  @Get('admin/strikes')
  async list(@Query('userId') userId: string) {
    return this.strikes.listForUser(userId);
  }

  /** `POST /v1/admin/users/:userId/strikes` — manually add a strike. */
  @Post('admin/users/:userId/strikes')
  @HttpCode(HttpStatus.OK)
  async addStrike(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: AddStrikeDto,
  ): Promise<{ created: boolean; suspended: boolean }> {
    return this.strikes.addStrike({
      userId,
      role: dto.role,
      points: dto.points,
      reason: dto.reason,
      severity: dto.severity,
      sourceType: dto.sourceType,
      sourceId: dto.sourceId ?? null,
      orderId: dto.orderId ?? null,
      deliveryId: dto.deliveryId ?? null,
      notes: dto.notes ?? null,
      createdBy: admin.id,
    });
  }

  /** `POST /v1/admin/users/:userId/suspend`. */
  @Post('admin/users/:userId/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async suspend(@Param('userId') userId: string, @Body() dto: SuspendUserDto): Promise<void> {
    await this.strikes.suspendUser(userId, dto.role, dto.reason);
  }

  /** `POST /v1/admin/users/:userId/unsuspend`. */
  @Post('admin/users/:userId/unsuspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsuspend(@Param('userId') userId: string): Promise<void> {
    await this.strikes.unsuspendUser(userId);
  }
}
