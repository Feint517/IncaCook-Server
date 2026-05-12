import { createHash } from 'node:crypto';

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { generateUlid } from '@common/utils/code-generator.util';

import { PrismaService } from '@infrastructure/database/prisma.service';

/**
 * Idempotency key store. Backed by the IdempotencyKey table.
 *
 * Pattern (caller side, supabaseId from the JWT):
 *
 *   const cached = await idempotency.get(supabaseId, key, body);
 *   if (cached) return cached;
 *   const response = await doTheWork();
 *   await idempotency.save(supabaseId, key, body, 200, response);
 *   return response;
 *
 * The service takes the JWT's supabaseId and internally resolves to the
 * User.id (ULID) that the IdempotencyKey table's FK references. Callers
 * never deal with the dual-id model.
 *
 * Three outcomes for a given (user, key):
 *   - First time → null returned, caller does the work, calls save()
 *   - Same key + same request body → cached response replayed
 *   - Same key + different body → ConflictException 409
 */
@Injectable()
export class IdempotencyService {
  /** Records older than this are eligible for cleanup (separate sweep job). */
  static readonly TTL_HOURS = 24;

  constructor(private readonly prisma: PrismaService) {}

  async get(
    supabaseId: string,
    key: string,
    requestBody: unknown,
  ): Promise<{ status: number; response: unknown } | null> {
    const userId = await this.resolveUserId(supabaseId);
    const requestHash = hashBody(requestBody);
    const existing = await this.prisma.db.idempotencyKey.findUnique({
      where: { userId_key: { userId, key } },
    });
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'Idempotency-Key reused with a different request body',
      );
    }
    return {
      status: existing.responseStatus,
      response: existing.responseBody as unknown,
    };
  }

  async save(
    supabaseId: string,
    key: string,
    requestBody: unknown,
    responseStatus: number,
    response: unknown,
  ): Promise<void> {
    const userId = await this.resolveUserId(supabaseId);
    const requestHash = hashBody(requestBody);
    const expiresAt = new Date(Date.now() + IdempotencyService.TTL_HOURS * 3600 * 1000);

    await this.prisma.db.idempotencyKey.create({
      data: {
        id: generateUlid(),
        userId,
        key,
        requestHash,
        responseStatus,
        responseBody: response as Prisma.InputJsonValue,
        expiresAt,
      },
    });
  }

  private async resolveUserId(supabaseId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { supabaseId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User profile not found');
    }
    return user.id;
  }
}

function hashBody(body: unknown): string {
  // Stable JSON serialization. Insertion order matters here — for v1 we
  // accept that a client reordering keys triggers a new "request". The
  // alternative (canonical JSON) is overkill at this point.
  const serialized = JSON.stringify(body ?? null);
  return createHash('sha256').update(serialized).digest('hex');
}
