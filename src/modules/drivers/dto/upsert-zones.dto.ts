import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for `PUT /v1/drivers/me/zones`. Replaces the driver's full set of
 * operating zones — service does delete-then-insert. Zone identifiers are
 * free strings for now; v2 will promote them to a Zone lookup.
 */
export class UpsertDriverZonesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one zone is required' })
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  zones!: string[];
}
