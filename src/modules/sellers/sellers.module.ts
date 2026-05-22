import { Module } from '@nestjs/common';

import { ListingsModule } from '@modules/listings/listings.module';

import { SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';

@Module({
  imports: [ListingsModule],
  controllers: [SellersController],
  providers: [SellersService],
})
export class SellersModule {}
