import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { DeviceTokensService } from './device-tokens.service';
import { DeleteDeviceTokenDto } from './dto/delete-device-token.dto';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto';

/**
 * Device push-token registration. Authenticated (the global JWT guard
 * applies — no `@Public()`), so the token is always linked to the caller.
 */
@Controller({ path: 'device-tokens', version: '1' })
export class DeviceTokensController {
  constructor(private readonly deviceTokens: DeviceTokensService) {}

  /** `POST /v1/device-tokens` — register/refresh the caller's FCM token. */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<void> {
    await this.deviceTokens.register(jwtUser.id, dto);
  }

  /** `DELETE /v1/device-tokens` — unregister a token (e.g. on logout). */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() jwtUser: AuthenticatedUser,
    @Body() dto: DeleteDeviceTokenDto,
  ): Promise<void> {
    await this.deviceTokens.remove(jwtUser.id, dto.token);
  }
}
