import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';

import { Public } from '@common/decorators/public.decorator';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { RedisService } from '@infrastructure/redis/redis.service';

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([async () => ({ liveness: { status: 'up' } })]);
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      async () => this.prismaIndicator.pingCheck('database', this.prisma),
      async () => {
        const ok = await this.redis.ping();
        return { redis: { status: ok ? 'up' : 'down' } };
      },
    ]);
  }
}
