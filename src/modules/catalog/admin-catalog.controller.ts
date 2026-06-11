import {
  Body,
  Controller,
  Delete,
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

import { CatalogAdminService } from './catalog-admin.service';
import { CatalogOrderResponseDto } from './dto/catalog-order.dto';
import {
  CatalogProductResponseDto,
  CreateCatalogProductDto,
  UpdateCatalogProductDto,
} from './dto/catalog-product.dto';

/**
 * Admin catalog management. Products created here are sold to sellers and
 * are invisible to buyers/public (the seller-facing `CatalogController`
 * gates on `@Roles(SELLER)`).
 */
@Controller({ path: 'admin/catalog', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminCatalogController {
  constructor(private readonly admin: CatalogAdminService) {}

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: CreateCatalogProductDto,
  ): Promise<CatalogProductResponseDto> {
    const p = await this.admin.create(jwtUser.id, dto);
    return CatalogProductResponseDto.from(p);
  }

  @Get('products')
  async list(): Promise<CatalogProductResponseDto[]> {
    const items = await this.admin.list();
    return items.map(CatalogProductResponseDto.from);
  }

  @Get('products/:id')
  async get(@Param('id') id: string): Promise<CatalogProductResponseDto> {
    return CatalogProductResponseDto.from(await this.admin.get(id));
  }

  @Patch('products/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCatalogProductDto,
  ): Promise<CatalogProductResponseDto> {
    return CatalogProductResponseDto.from(await this.admin.update(id, dto));
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.admin.remove(id);
  }

  /** All catalog purchases across sellers (newest first). */
  @Get('orders')
  async orders(): Promise<
    Array<CatalogOrderResponseDto & { seller: { id: string; name: string; email: string } }>
  > {
    const orders = await this.admin.listOrders();
    return orders.map((o) => ({
      ...CatalogOrderResponseDto.from(o),
      seller: {
        id: o.seller.id,
        name: `${o.seller.firstName} ${o.seller.lastName}`.trim(),
        email: o.seller.email,
      },
    }));
  }
}
