import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-ioredis-yet';

import { redisConfig } from '@config/redis.config';

import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule.forFeature(redisConfig)],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        store: await redisStore({
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          password: config.get<string>('redis.password') || undefined,
        }),
      }),
    }),
  ],
  providers: [CacheService],
  exports: [CacheService, NestCacheModule],
})
export class CacheModule {}
