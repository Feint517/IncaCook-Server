import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { redisConfig } from '@config/redis.config';

import { QueueService } from './queue.service';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(redisConfig),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('redis.url');
        const host = config.get<string>('redis.host', 'localhost');
        const port = config.get<number>('redis.port', 6379);
        const password = config.get<string>('redis.password') || undefined;
        return {
          connection: url ? { url } : { host, port, password },
        };
      },
    }),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
