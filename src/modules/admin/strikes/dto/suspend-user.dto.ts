import { IsIn, IsString, MaxLength } from 'class-validator';

import type { ActorRole } from '@modules/strikes/strikes.service';

/** Body for `POST /v1/admin/users/:userId/suspend`. */
export class SuspendUserDto {
  @IsIn(['SELLER', 'DRIVER', 'BUYER'])
  role!: ActorRole;

  @IsString()
  @MaxLength(200)
  reason!: string;
}
