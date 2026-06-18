import { CharterKind } from '@prisma/client';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `POST /v1/admin/legal-documents` — creates a draft (inactive)
 *  CGU or CGV document. Only CGU/CGV are managed by this feature even though
 *  CharterKind has more values. Publishing is a separate explicit step. */
export class CreateLegalDocumentDto {
  @IsIn([CharterKind.CGU, CharterKind.CGV])
  kind!: CharterKind;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  version!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100000)
  content!: string;
}
