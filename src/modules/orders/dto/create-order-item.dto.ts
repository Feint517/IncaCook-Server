import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * One cart line. The buyer sends listing_id + quantity + selected add-on
 * IDs. Server resolves the IDs against the listing's add-ons and snapshots
 * label + priceDelta into the OrderItemAddOn rows.
 */
export class CreateOrderItemDto {
  @IsString()
  listingId!: string;

  @IsInt() @Min(1)
  quantity!: number;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  addOnIds?: string[];
}
