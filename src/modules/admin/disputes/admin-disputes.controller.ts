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

import { OrdersService } from '@modules/orders/orders.service';

import { DisputeActionDto } from './dto/dispute-action.dto';

/** Admin/moderator management of buyer post-delivery disputes. */
@Controller({ version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminDisputesController {
  constructor(private readonly orders: OrdersService) {}

  /** `GET /v1/admin/disputes?status=&type=&search=` */
  @Get('admin/disputes')
  async list(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    return this.orders.listDisputes({ status, type, search });
  }

  /** `GET /v1/admin/disputes/:id` */
  @Get('admin/disputes/:id')
  async byId(@Param('id') id: string) {
    return this.orders.getDispute(id);
  }

  /** `POST /v1/admin/disputes/:id/approve-refund` — refunds (idempotent) + resolves. */
  @Post('admin/disputes/:id/approve-refund')
  @HttpCode(HttpStatus.OK)
  async approveRefund(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DisputeActionDto,
  ) {
    return this.orders.adminApproveRefund(id, admin.id, dto.notes);
  }

  /** `POST /v1/admin/disputes/:id/reject` */
  @Post('admin/disputes/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DisputeActionDto,
  ) {
    return this.orders.adminRejectDispute(id, admin.id, dto.notes);
  }

  /** `POST /v1/admin/disputes/:id/resolve` — close without refund. */
  @Post('admin/disputes/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DisputeActionDto,
  ) {
    return this.orders.adminResolveDispute(id, admin.id, dto.notes);
  }
}
