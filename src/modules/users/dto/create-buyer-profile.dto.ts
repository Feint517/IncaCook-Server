import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, ValidateNested } from 'class-validator';

import { Allergen } from '@common/enums/allergen.enum';
import { Dietary } from '@common/enums/dietary.enum';

import { CreateAddressDto } from './create-address.dto';

/**
 * Sub-DTO carried inside `CreateUserDto` when role = BUYER. All fields are
 * optional — a buyer can complete signup with no preferences and no saved
 * address, and the BuyerProfile row is created with empty arrays.
 */
export class CreateBuyerProfileDto {
  @IsOptional()
  @IsArray()
  @IsEnum(Dietary, { each: true })
  dietaryPreferences?: Dietary[];

  @IsOptional()
  @IsArray()
  @IsEnum(Allergen, { each: true })
  allergies?: Allergen[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  defaultAddress?: CreateAddressDto;
}
