import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Add-on row sent inside the listing payload. The seller manages the whole
 * menu in one POST/PATCH; we don't expose per-add-on endpoints.
 *
 * `priceDeltaCents` can be negative ("no cheese: -50¢").
 */
export class CreateListingAddOnDto {
  @IsString() @MinLength(1) @MaxLength(120)
  label!: string;

  @IsInt()
  priceDeltaCents!: number;

  @IsOptional()
  @IsBoolean()
  isSelectedByDefault?: boolean;
}
