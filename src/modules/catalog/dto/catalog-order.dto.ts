import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type { CatalogOrder, CatalogOrderItem, CatalogOrderStatus } from '@prisma/client';

export class CreateCatalogOrderItemDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

/** Seller purchases one or more catalog products. */
export class CreateCatalogOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateCatalogOrderItemDto)
  items!: CreateCatalogOrderItemDto[];
}

/** `POST /v1/catalog/orders` — order created + Stripe secret to confirm. */
export class CatalogCheckoutResponseDto {
  orderId!: string;
  /** PaymentIntent client secret for in-app card confirmation. */
  clientSecret!: string | null;
  totalCents!: number;
  currency!: string;
}

class CatalogOrderItemResponseDto {
  productId!: string | null;
  name!: string;
  unitPriceCents!: number;
  quantity!: number;
  lineTotalCents!: number;
}

export class CatalogOrderResponseDto {
  id!: string;
  status!: CatalogOrderStatus;
  totalCents!: number;
  currency!: string;
  createdAt!: string;
  paidAt!: string | null;
  items!: CatalogOrderItemResponseDto[];

  static from(o: CatalogOrder & { items: CatalogOrderItem[] }): CatalogOrderResponseDto {
    return {
      id: o.id,
      status: o.status,
      totalCents: o.totalCents,
      currency: o.currency,
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
      items: o.items.map((it) => ({
        productId: it.productId,
        name: it.nameSnapshot,
        unitPriceCents: it.unitPriceCents,
        quantity: it.quantity,
        lineTotalCents: it.lineTotalCents,
      })),
    };
  }
}
