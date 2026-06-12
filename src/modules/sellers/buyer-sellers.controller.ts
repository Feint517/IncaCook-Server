import { Controller, Get } from '@nestjs/common';

import { KitchenSummaryDto } from './dto/kitchen-summary.dto';
import { SellersService } from './sellers.service';

/**
 * Buyer-facing seller endpoints (path `sellers`, distinct from the seller's
 * own `sellers/me`). Powers the "Kitchens near you" home section.
 */
@Controller({ path: 'sellers', version: '1' })
export class BuyerSellersController {
  constructor(private readonly sellers: SellersService) {}

  /** Active sellers with a set-up profile, mapped to kitchen cards. */
  @Get()
  listKitchens(): Promise<KitchenSummaryDto[]> {
    return this.sellers.listKitchens();
  }
}
