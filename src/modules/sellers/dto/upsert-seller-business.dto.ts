import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DayOfWeek } from '@prisma/client';

/** One opening-hours row, mirrors SellerOpeningHours. HH:MM (24h) strings. */
export class OpeningHoursDto {
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM (24h)' })
  startTime!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must be HH:MM (24h)' })
  endTime!: string;
}

/**
 * Body for `PUT /v1/sellers/me/business`. Upserts the SellerBusiness row
 * and replaces the seller's full opening-hours set in one transaction.
 * Only valid for non-fait-maison sellers (service-layer enforced).
 */
export class UpsertSellerBusinessDto {
  @IsString() @MinLength(1) @MaxLength(200)
  businessName!: string;

  /** 14 digits, Luhn-validated at the service layer. */
  @Matches(/^\d{14}$/, { message: 'siret must be exactly 14 digits' })
  siret!: string;

  /** Storage object key in `seller-facades/` (Phase D signed URL flow). */
  @IsOptional() @IsString() @MaxLength(500)
  facadeUrl?: string;

  @IsOptional() @IsString() @MaxLength(80)
  legalForm?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique((h: OpeningHoursDto) => h.dayOfWeek)
  @ValidateNested({ each: true })
  @Type(() => OpeningHoursDto)
  openingHours?: OpeningHoursDto[];
}
