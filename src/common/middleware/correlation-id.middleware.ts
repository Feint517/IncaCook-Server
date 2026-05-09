import { Injectable, NestMiddleware } from '@nestjs/common';
import { ulid } from 'ulid';

import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? ulid();
    req.correlationId = id;
    res.setHeader(CORRELATION_ID_HEADER, id);
    next();
  }
}
