import { Module } from '@nestjs/common';

import { ListingsModule } from '@modules/listings/listings.module';

import { BuyerSellersController } from './buyer-sellers.controller';
import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';

@Module({
  imports: [ListingsModule],
  controllers: [SellersController, BuyerSellersController],
  providers: [SellersService],
})
export class SellersModule {}
