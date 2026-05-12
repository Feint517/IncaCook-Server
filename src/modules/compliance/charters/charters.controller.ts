import { Controller, Get } from '@nestjs/common';
import { CharterKind } from '@prisma/client';

import { Public } from '@common/decorators/public.decorator';

import { ACTIVE_CHARTER_VERSIONS } from './charters.constants';

@Controller({ path: 'charters', version: '1' })
export class ChartersController {
  /**
   * Returns the currently-active version of each charter. Public — the
   * Flutter app reads this before signup (CGU/CGV are shown pre-account).
   */
  @Public()
  @Get('active')
  active(): Record<CharterKind, string> {
    return ACTIVE_CHARTER_VERSIONS;
  }
}
