import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { DeliveriesService } from './deliveries.service';
import { DeliveryListResponseDto, DeliveryResponseDto } from './dto/delivery-response.dto';
import { DriverLocationDto } from './dto/driver-location.dto';
import { ListDeliveriesQueryDto } from './dto/list-deliveries.query.dto';
import { OnlineStatusDto } from './dto/online-status.dto';
import { ReportIssueDto } from './dto/report-issue.dto';

/**
 * All driver-facing delivery endpoints. No class-level path so we can
 * serve `/drivers/me/online` and `/drivers/me/deliveries/...` from one
 * controller. Same approach as orders.controller.ts.
 */
@Controller({ version: '1' })
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /**
   * Toggle the driver's online state. Optionally piggy-backs a location
   * update for matching. KYC must be APPROVED before going online.
   */
  @Post('drivers/me/online')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOnline(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: OnlineStatusDto,
  ): Promise<void> {
    await this.deliveries.setOnline(jwtUser.id, dto);
  }

  /**
   * High-frequency position update. Called every few seconds while a
   * delivery is active. Persists last-known point and, when the driver
   * is mid-delivery, fans out via Redis to the buyer's tracking socket.
   */
  @Post('drivers/me/location')
  async pushLocation(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: DriverLocationDto,
  ): Promise<{ broadcast: boolean; deliveryId: string | null }> {
    return this.deliveries.recordLocation(jwtUser.id, dto);
  }

  /** Available SEARCHING deliveries for the driver to claim, FIFO. */
  @Get('drivers/me/deliveries/available')
  async listAvailable(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<DeliveryListResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const result = await this.deliveries.listAvailable(jwtUser.id, limit, offset);
    return {
      items: result.items.map(({ row, enrichment }) => DeliveryResponseDto.from(row, enrichment)),
      limit,
      offset,
      hasMore: result.hasMore,
    };
  }

  /** Driver's own deliveries (current + history). */
  @Get('drivers/me/deliveries')
  async listMine(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<DeliveryListResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const result = await this.deliveries.listMine(jwtUser.id, query.status, limit, offset);
    return {
      items: result.items.map((d) => DeliveryResponseDto.from(d)),
      limit,
      offset,
      hasMore: result.hasMore,
    };
  }

  /** Detail view. Drivers can fetch deliveries they own or claim-able ones. */
  @Get('drivers/me/deliveries/:id')
  async findById(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveries.findById(jwtUser.id, id);
    return DeliveryResponseDto.from(delivery);
  }

  /** Atomic claim. 409 if another driver beat us to it. */
  @Post('drivers/me/deliveries/:id/claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveries.claim(jwtUser.id, id);
    return DeliveryResponseDto.from(delivery);
  }

  /** ASSIGNED → AT_PICKUP. Driver has reached the seller. */
  @Post('drivers/me/deliveries/:id/arrive-pickup')
  @HttpCode(HttpStatus.OK)
  async arriveAtPickup(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveries.arriveAtPickup(jwtUser.id, id);
    return DeliveryResponseDto.from(delivery);
  }

  /**
   * AT_PICKUP → PICKED_UP. Driver has the food. Order → IN_DELIVERY.
   */
  @Post('drivers/me/deliveries/:id/confirm-pickup')
  @HttpCode(HttpStatus.OK)
  async confirmPickup(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveries.confirmPickup(jwtUser.id, id);
    return DeliveryResponseDto.from(delivery);
  }

  /**
   * PICKED_UP → DELIVERED. Order → DELIVERED. Triggers Stripe transfers
   * to seller and driver via OrdersService.confirmDeliveredByDriver.
   */
  @Post('drivers/me/deliveries/:id/confirm-delivery')
  @HttpCode(HttpStatus.OK)
  async confirmDelivery(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<DeliveryResponseDto> {
    const delivery = await this.deliveries.confirmDelivery(jwtUser.id, id);
    return DeliveryResponseDto.from(delivery);
  }

  /**
   * Driver-reported issue. ABORT severity is logged for admin
   * intervention; this endpoint does NOT auto-cancel/refund.
   */
  @Post('drivers/me/deliveries/:id/report-issue')
  @HttpCode(HttpStatus.CREATED)
  async reportIssue(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReportIssueDto,
  ): Promise<{ id: string; severity: string }> {
    return this.deliveries.reportIssue(jwtUser.id, id, dto);
  }
}
