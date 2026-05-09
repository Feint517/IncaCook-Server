import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import type { Request } from 'express';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/**
 * Extracts the `Idempotency-Key` header from the request. Returns undefined
 * if no header is present. Mutating endpoints should require this.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const value = request.headers[IDEMPOTENCY_HEADER];
    return Array.isArray(value) ? value[0] : value;
  },
);
