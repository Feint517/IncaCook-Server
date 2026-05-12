import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { CharterKind } from '@prisma/client';

/**
 * Body for `POST /v1/users/me/charters`. Records that the caller accepted
 * a specific charter version. Composite PK (userId, charter, version)
 * means re-posting the same version is idempotent (upsert no-op).
 */
export class RecordCharterDto {
  @IsEnum(CharterKind)
  charter!: CharterKind;

  @IsString() @MinLength(1) @MaxLength(20)
  version!: string;
}
