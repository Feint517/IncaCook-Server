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

import { CatalogClaimsService } from './catalog-claims.service';
import {
  CatalogClaimActionDto,
  CatalogClaimRefundDto,
  CatalogClaimResponseDto,
} from './dto/catalog-claim.dto';

/**
 * Admin SAV management for kitchen catalog claims. ADMIN/MODERATOR only.
 * Decisions (refund / replacement / reject / resolve) are manual.
 */
@Controller({ version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminCatalogClaimsController {
  constructor(private readonly claims: CatalogClaimsService) {}

  /** `GET /v1/admin/catalog-claims?status=&type=&search=` */
  @Get('admin/catalog-claims')
  async list(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
  ): Promise<CatalogClaimResponseDto[]> {
    const rows = await this.claims.adminList({ status, type, search });
    return rows.map(CatalogClaimResponseDto.from);
  }

  /** `GET /v1/admin/catalog-claims/:id` — claim + order + items + seller. */
  @Get('admin/catalog-claims/:id')
  async byId(@Param('id') id: string) {
    const { claim, order, seller } = await this.claims.adminGet(id);
    return { ...CatalogClaimResponseDto.from(claim), order, seller };
  }

  /** `POST /v1/admin/catalog-claims/:id/refund` — Stripe refund (idempotent) + REFUNDED. */
  @Post('admin/catalog-claims/:id/refund')
  @HttpCode(HttpStatus.OK)
  async refund(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CatalogClaimRefundDto,
  ): Promise<CatalogClaimResponseDto> {
    return CatalogClaimResponseDto.from(await this.claims.adminRefund(id, admin.id, dto));
  }

  /** `POST /v1/admin/catalog-claims/:id/request-replacement` */
  @Post('admin/catalog-claims/:id/request-replacement')
  @HttpCode(HttpStatus.OK)
  async requestReplacement(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CatalogClaimActionDto,
  ): Promise<CatalogClaimResponseDto> {
    return CatalogClaimResponseDto.from(
      await this.claims.adminRequestReplacement(id, admin.id, dto),
    );
  }

  /** `POST /v1/admin/catalog-claims/:id/reject` */
  @Post('admin/catalog-claims/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CatalogClaimActionDto,
  ): Promise<CatalogClaimResponseDto> {
    return CatalogClaimResponseDto.from(await this.claims.adminReject(id, admin.id, dto));
  }

  /** `POST /v1/admin/catalog-claims/:id/resolve` */
  @Post('admin/catalog-claims/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CatalogClaimActionDto,
  ): Promise<CatalogClaimResponseDto> {
    return CatalogClaimResponseDto.from(await this.claims.adminResolve(id, admin.id, dto));
  }
}
