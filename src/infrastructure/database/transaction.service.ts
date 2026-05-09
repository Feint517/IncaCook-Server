import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from './prisma.service';

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run a callback inside a Prisma transaction. Repositories that need to
   * coordinate multiple writes should accept the returned `tx` client
   * instead of calling `prisma` directly.
   */
  async run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
