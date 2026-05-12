import { Module } from '@nestjs/common';

import { IdempotencyService } from '@common/services/idempotency.service';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, IdempotencyService],
  exports: [OrdersService],
})
export class OrdersModule {}
