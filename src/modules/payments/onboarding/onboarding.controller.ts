import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { AccountLinkResponseDto } from './dto/account-link-response.dto';
import { OnboardingService } from './onboarding.service';

@Controller({ path: 'stripe/onboarding', version: '1' })
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /**
   * Creates a Stripe Connect Express account on first call (idempotent on
   * subsequent calls — reuses the existing account). Returns a fresh
   * Account Link the Flutter app opens to send the user through Stripe's
   * hosted onboarding form.
   */
  @Post('account-link')
  @HttpCode(HttpStatus.CREATED)
  async createAccountLink(
    @CurrentUser() jwtUser: AuthenticatedUser,
  ): Promise<AccountLinkResponseDto> {
    return this.onboarding.createAccountLink(jwtUser.id);
  }
}
