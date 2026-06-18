import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `PATCH /v1/admin/legal-documents/:id` — edits a document's
 *  version/title/content. `kind` is immutable (create a new document to change
 *  it). All fields optional so partial edits are allowed. */
export class UpdateLegalDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  version?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100000)
  content?: string;
}
