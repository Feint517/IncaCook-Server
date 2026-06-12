import { CuisineType, DishType } from '@prisma/client';
import { ArrayMinSize, ArrayUnique, IsArray, IsEnum } from 'class-validator';

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

  // Dish types apply only to traiteur/restaurant; fait-maison sellers have
  // none, so an empty list is valid here. The "≥1 for traiteur/restaurant"
  // rule is enforced in the service, which knows the seller's category.
  @IsArray()
  @ArrayUnique()
  @IsEnum(DishType, { each: true })
  dishTypes!: DishType[];
}
