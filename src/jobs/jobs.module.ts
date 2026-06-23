import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { QueueNames } from '@infrastructure/queue/queue.constants';

import { OrdersModule } from '@modules/orders/orders.module';
import { WalletsModule } from '@modules/wallets/wallets.module';

import { OrderTimersProcessor } from './order-timers.processor';
import { WalletReleaseProcessor } from './wallet-release.processor';

/**
 * Aggregates the BullMQ processors for durable business timers. Loaded by
 * `worker.ts` (the standalone worker process) — NOT by the API, so the API
 * only *schedules* jobs while the worker *processes* them. Processors delegate
 * to the existing idempotent service methods in OrdersModule / WalletsModule.
 *
 * `registerQueue` binds each processor's Worker to the shared connection from
 * the global `QueueModule` (`BullModule.forRootAsync`).
 */
@Module({
  imports: [
    OrdersModule,
    WalletsModule,
    BullModule.registerQueue({ name: QueueNames.OrderTimeout }, { name: QueueNames.WalletRelease }),
  ],
  providers: [OrderTimersProcessor, WalletReleaseProcessor],
})
export class JobsModule {}
