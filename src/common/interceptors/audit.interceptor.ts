import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

import type { AuthenticatedRequest } from '@common/types/authenticated-request.type';

import { AuditService } from '@infrastructure/audit/audit.service';

/**
 * Wires AuditService.log() into mutating endpoints. Apply with
 * @UseInterceptors(AuditInterceptor) on routes that change state.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const action = `${request.method} ${request.route?.path ?? request.url}`;
    const targetId = request.params?.id;
    const target = typeof targetId === 'string' ? targetId : undefined;

    return next.handle().pipe(
      tap((response) => {
        this.audit
          .log({
            actor: request.user?.id ?? 'anonymous',
            action,
            target,
            metadata: { correlationId: request.correlationId, response },
          })
          .catch(() => {
            // audit failures must never crash the request
          });
      }),
    );
  }
}
