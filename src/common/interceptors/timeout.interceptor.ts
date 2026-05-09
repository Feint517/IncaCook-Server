import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

const DEFAULT_TIMEOUT_MS = 30_000;

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  private readonly timeoutMs =
    parseInt(process.env.REQUEST_TIMEOUT_MS ?? '', 10) || DEFAULT_TIMEOUT_MS;

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          return throwError(() => new RequestTimeoutException('Request timed out'));
        }
        return throwError(() => err);
      }),
    );
  }
}
