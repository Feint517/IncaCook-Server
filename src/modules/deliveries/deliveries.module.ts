import { Module } from '@nestjs/common';

import { OrdersModule } from '@modules/orders/orders.module';

import { DeliveriesController } from './deliveries.controller';
import { DeliveriesService } from './deliveries.service';

@Module({
  imports: [OrdersModule], // for OrdersService.confirmDeliveredByDriver
  controllers: [DeliveriesController],
  providers: [DeliveriesService],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
