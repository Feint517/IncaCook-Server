import { Injectable, NestMiddleware } from '@nestjs/common';

import type { NextFunction, Request, Response } from 'express';

/**
 * Placeholder for AsyncLocalStorage-backed request context. Will be wired
 * once a use case requires reading correlationId/userId from deep service
 * calls without prop drilling.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    next();
  }
}
