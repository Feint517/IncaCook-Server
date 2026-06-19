import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import type { ActorRole, StrikeSeverity, StrikeSourceType } from '@modules/strikes/strikes.service';

/** Body for `POST /v1/admin/users/:userId/strikes`. */
export class AddStrikeDto {
  @IsIn(['SELLER', 'DRIVER', 'BUYER'])
  role!: ActorRole;

  @IsInt()
  @Min(1)
  @Max(3)
  points!: number;

  @IsString()
  @MaxLength(120)
  reason!: string;

  @IsIn(['LIGHT', 'SERIOUS', 'CRITICAL'])
  severity!: StrikeSeverity;

  @IsIn(['DELIVERY', 'ORDER', 'REPORT', 'SYSTEM'])
  sourceType!: StrikeSourceType;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  deliveryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
