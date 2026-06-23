import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { CatalogClaimsService } from './catalog-claims.service';
import { CatalogService } from './catalog.service';
import { CatalogClaimResponseDto, CreateCatalogClaimDto } from './dto/catalog-claim.dto';
import {
  CatalogCheckoutResponseDto,
  CatalogOrderResponseDto,
  CreateCatalogOrderDto,
} from './dto/catalog-order.dto';
import { CatalogProductResponseDto } from './dto/catalog-product.dto';

/**
 * Seller-facing catalog. Guarded by `@Roles(SELLER)` — buyers, drivers and
 * the public can't reach any of these routes, so the admin product catalog
 * is visible only to sellers.
 */
@Controller({ path: 'catalog', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Seller)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly claims: CatalogClaimsService,
  ) {}

  /** Browse active products. */
  @Get('products')
  async products(): Promise<CatalogProductResponseDto[]> {
    const items = await this.catalog.listProducts();
    return items.map(CatalogProductResponseDto.from);
  }

  @Get('products/:id')
  async product(@Param('id') id: string): Promise<CatalogProductResponseDto> {
    return CatalogProductResponseDto.from(await this.catalog.getProduct(id));
  }

  /** Purchase: creates a PENDING order + PaymentIntent (confirm in-app). */
  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  createOrder(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: CreateCatalogOrderDto,
  ): Promise<CatalogCheckoutResponseDto> {
    return this.catalog.createOrder(jwtUser.id, dto);
  }

  /** Server-verified confirm after the app confirms the card. */
  @Post('orders/:id/confirm-payment')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<CatalogOrderResponseDto> {
    return CatalogOrderResponseDto.from(await this.catalog.confirmPayment(jwtUser.id, id));
  }

  /** The seller's own purchases. */
  @Get('orders')
  async myOrders(@CurrentUser() jwtUser: AuthenticatedUser): Promise<CatalogOrderResponseDto[]> {
    const orders = await this.catalog.listMyOrders(jwtUser.id);
    return orders.map(CatalogOrderResponseDto.from);
  }

  /** Open an after-sales (SAV) claim on a catalog order (within 14 days). */
  @Post('orders/:orderId/claims')
  @HttpCode(HttpStatus.CREATED)
  async createClaim(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('orderId') orderId: string,
    @Body() dto: CreateCatalogClaimDto,
  ): Promise<CatalogClaimResponseDto> {
    return CatalogClaimResponseDto.from(await this.claims.createClaim(jwtUser.id, orderId, dto));
  }

  /** The seller's own SAV claims (for status display in the app). */
  @Get('claims')
  async myClaims(@CurrentUser() jwtUser: AuthenticatedUser): Promise<CatalogClaimResponseDto[]> {
    const claims = await this.claims.listMyClaims(jwtUser.id);
    return claims.map(CatalogClaimResponseDto.from);
  }
}
