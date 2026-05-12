import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { FilesService } from './files.service';

@Controller({ path: 'uploads', version: '1' })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /**
   * Issues a Supabase signed upload URL. The Flutter app PUTs the file
   * body directly to `uploadUrl`, then sends `path` back to the
   * resource-specific endpoint (e.g. `PUT /sellers/me/profile` with
   * `profilePhotoUrl=<path>`). Two-step uploads make resumable, large
   * mobile uploads simpler — the metadata write is independent of the
   * upload itself.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createUploadUrl(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    return this.files.createUploadUrl(jwtUser.id, dto);
  }
}
