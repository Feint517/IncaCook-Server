import { ArrayMinSize, ArrayUnique, IsArray, IsEnum } from 'class-validator';
import { CuisineType, DishType } from '@prisma/client';

/**
 * Body for `PUT /v1/sellers/me/cuisines`. Replaces the seller's full set
 * of cuisine and dish types — the service does a delete-then-insert
 * inside a transaction.
 */
export class UpsertSellerCuisinesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one cuisine type is required' })
  @ArrayUnique()
  @IsEnum(CuisineType, { each: true })
  cuisines!: CuisineType[];

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one dish type is required' })
  @ArrayUnique()
  @IsEnum(DishType, { each: true })
  dishTypes!: DishType[];
}
