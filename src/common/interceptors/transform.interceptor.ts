import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta: {
    timestamp: string;
    version: string;
  };
  pagination?: {
    nextCursor?: string;
    hasMore?: boolean;
    total?: number;
    page?: number;
    limit?: number;
  };
}

interface PaginatedPayload<T> {
  items: T[];
  total?: number;
  nextCursor?: string;
  hasMore?: boolean;
  page?: number;
  limit?: number;
}

function isPaginated<T>(value: unknown): value is PaginatedPayload<T> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        const meta = {
          timestamp: new Date().toISOString(),
          version: process.env.API_VERSION ?? 'v1',
        };

        if (isPaginated<T>(data)) {
          const { items, total, nextCursor, hasMore, page, limit } = data;
          return {
            success: true,
            data: items as unknown as T,
            meta,
            pagination: { total, nextCursor, hasMore, page, limit },
          };
        }

        return { success: true, data, meta };
      }),
    );
  }
}
