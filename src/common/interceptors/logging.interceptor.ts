import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

import type { AuthenticatedRequest } from '@common/types/authenticated-request.type';

import type { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & Partial<AuthenticatedRequest>>();
    const response = http.getResponse<Response>();
    const start = Date.now();
    const { method, url, ip } = request;
    const userId = request.user?.id;
    const correlationId = request.correlationId;

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.logger.log(
            `[${correlationId ?? '-'}] ${method} ${url} ${response.statusCode} ${duration}ms user=${userId ?? 'anon'} ip=${ip}`,
          );
        },
        error: (err: unknown) => {
          const duration = Date.now() - start;
          const status = (err as { status?: number })?.status ?? 500;
          this.logger.warn(
            `[${correlationId ?? '-'}] ${method} ${url} ${status} ${duration}ms user=${userId ?? 'anon'} ip=${ip}`,
          );
        },
      }),
    );
  }
}
