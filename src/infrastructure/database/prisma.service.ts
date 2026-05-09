import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { softDeleteExtension } from './soft-delete.extension';

/**
 * PrismaService extends PrismaClient so it can be passed directly to anything
 * that expects a vanilla Prisma client (e.g. terminus's PrismaHealthIndicator).
 *
 * For normal queries, use `this.prisma.db` — that's the soft-delete-aware
 * extended client. The raw client is still reachable on `this.prisma`
 * itself (e.g. `this.prisma.$queryRaw`) when bypassing extensions is needed.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Soft-delete-aware client. Default for repository code. */
  readonly db = this.$extends(softDeleteExtension);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Prisma connected');
    } catch (err) {
      this.logger.warn(
        `Prisma eager connect failed; will reconnect on first query (${(err as Error).message})`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
