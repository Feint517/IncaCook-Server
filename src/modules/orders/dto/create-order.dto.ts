import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { DeliveryTiming } from '@common/enums/delivery-timing.enum';
import { FulfillmentChoice } from '@common/enums/fulfillment-choice.enum';

import { CreateAddressDto } from '@modules/users/dto/create-address.dto';

import { CreateOrderItemDto } from './create-order-item.dto';

/**
 * Body for `POST /v1/orders`. The buyer is resolved from the JWT.
 *
 * Single-seller orders only in v1: all `items[*].listingId` must belong to
 * the same seller. Service-layer enforced.
 *
 * Drop-off can be either:
 *   - `dropoffAddressId` of an existing Address belonging to the buyer, OR
 *   - `dropoffAddress` (full inline) — server creates a new Address.
 *
 * Exactly one of the two must be present (XOR enforced in service).
 */
export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @IsEnum(FulfillmentChoice)
  fulfillmentChoice!: FulfillmentChoice;

  @IsOptional()
  @IsString()
  dropoffAddressId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  dropoffAddress?: CreateAddressDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryInstructions?: string;

  @IsOptional()
  @IsEnum(DeliveryTiming)
  deliveryTiming?: DeliveryTiming;

  /** Required iff deliveryTiming = SCHEDULED. */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Buyer's CGU/CGV consent at purchase. Transient (validation-only — the
   * durable consent record is a UserCharter row). The service rejects the
   * order unless this is `true`.
   */
  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}
