import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import 'reflect-metadata';

import { ConfigModule } from '@config/config.module';

import { AuditModule } from '@infrastructure/audit/audit.module';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { QueueModule } from '@infrastructure/queue/queue.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { StripeModule } from '@infrastructure/stripe/stripe.module';
import { SupabaseModule } from '@infrastructure/supabase/supabase.module';

import { JobsModule } from '@jobs/jobs.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    SupabaseModule,
    AuditModule,
    // OrdersService (pulled in by JobsModule) injects SchedulerRegistry +
    // StripeService; both must be available in the worker's DI graph.
    ScheduleModule.forRoot(),
    StripeModule,
    JobsModule,
  ],
})
class WorkerAppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerAppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  const logger = app.get(PinoLogger);
  logger.log('🛠  incacook-worker started — processors are subscribed to BullMQ queues');

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal}, shutting down worker`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap worker', err);
  process.exit(1);
});
