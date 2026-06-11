import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `PATCH /v1/users/me` — lets any authenticated user edit their
 * own profile basics (display name + avatar). All fields optional; only
 * the provided ones are updated. Role-specific data (seller business,
 * driver vehicle, etc.) keeps its own dedicated endpoints.
 *
 * `avatarPath` is a storage object key (returned by the upload flow), the
 * same shape stored on `User.avatarPath`.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatarPath?: string;
}
