import { Module } from '@nestjs/common';

/**
 * Aggregates all BullMQ processors and cron schedulers. Loaded by
 * `worker.ts` for the standalone worker process. Processors will be added
 * in subsequent tasks.
 */
@Module({})
export class JobsModule {}
