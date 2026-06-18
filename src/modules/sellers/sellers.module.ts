import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { revenueCatConfig } from '@config/revenuecat.config';

import { ListingsModule } from '@modules/listings/listings.module';

import { BuyerSellersController } from './buyer-sellers.controller';
import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';

@Module({
  imports: [ListingsModule, ConfigModule.forFeature(revenueCatConfig)],
  controllers: [SellersController, BuyerSellersController],
  providers: [SellersService],
})
export class SellersModule {}
