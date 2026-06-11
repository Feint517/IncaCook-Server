import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import { RolesGuard } from '@common/guards/roles.guard';
import type { AuthenticatedUser } from '@common/types/authenticated-request.type';

import { WalletService } from './wallets.service';

@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** Authenticated user's wallet: available/held/paid-out + recent entries. */
  @Get('me')
  async me(@CurrentUser() jwtUser: AuthenticatedUser) {
    return this.wallet.summary(jwtUser.id);
  }

  /**
   * Withdraw the full AVAILABLE balance to the user's Stripe Connect account.
   * Requires balance >= 50 € (enforced server-side).
   */
  @Post('me/withdraw')
  @HttpCode(HttpStatus.OK)
  async withdraw(@CurrentUser() jwtUser: AuthenticatedUser) {
    return this.wallet.requestWithdrawal(jwtUser.id);
  }
}

/** Admin debug visibility into an order's money split + wallet ledger. */
@Controller({ path: 'admin/orders', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin, UserRole.Moderator)
export class AdminOrderFinancialsController {
  constructor(private readonly wallet: WalletService) {}

  @Get(':id/financials')
  async financials(@Param('id') id: string) {
    return this.wallet.orderFinancials(id);
  }
}
