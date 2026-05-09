import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/node';
import { ZodError } from 'zod';

import { ErrorCode, ErrorCodes } from '@common/constants/error-codes.constants';
import { DomainException } from '@common/exceptions/domain.exception';

import type { Request, Response } from 'express';

interface ErrorPayload {
  statusCode: number;
  message: string;
  error: string;
  code: ErrorCode;
  timestamp: string;
  path: string;
  correlationId?: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const payload = this.toPayload(exception, request);

    this.logger.error(
      `[${payload.correlationId ?? '-'}] ${payload.statusCode} ${request.method} ${request.url} :: ${payload.message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    if (payload.statusCode >= 500 && process.env.NODE_ENV === 'production') {
      Sentry.captureException(exception, {
        tags: { correlationId: payload.correlationId ?? 'unknown' },
        extra: { path: payload.path, method: request.method },
      });
    }

    response.status(payload.statusCode).json({
      success: false,
      error: payload,
    });
  }

  private toPayload(
    exception: unknown,
    request: Request & { correlationId?: string },
  ): ErrorPayload {
    const base: Pick<ErrorPayload, 'timestamp' | 'path' | 'correlationId'> = {
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId: request.correlationId,
    };

    if (exception instanceof DomainException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string }).message ?? exception.message);
      return {
        ...base,
        statusCode: status,
        message,
        error: HttpStatus[status] ?? 'Error',
        code: exception.code,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : (((body as { message?: string | string[] }).message as string) ?? exception.message);
      return {
        ...base,
        statusCode: status,
        message: Array.isArray(message) ? message.join('; ') : message,
        error: HttpStatus[status] ?? 'Error',
        code: this.codeForStatus(status),
        details: typeof body === 'object' ? body : undefined,
      };
    }

    if (exception instanceof ZodError) {
      return {
        ...base,
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        error: 'Bad Request',
        code: ErrorCodes.ValidationFailed,
        details: exception.errors,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception, base);
    }

    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
      code: ErrorCodes.Unknown,
    };
  }

  private fromPrisma(
    err: Prisma.PrismaClientKnownRequestError,
    base: Pick<ErrorPayload, 'timestamp' | 'path' | 'correlationId'>,
  ): ErrorPayload {
    switch (err.code) {
      case 'P2002':
        return {
          ...base,
          statusCode: HttpStatus.CONFLICT,
          message: 'Resource already exists',
          error: 'Conflict',
          code: ErrorCodes.Conflict,
        };
      case 'P2025':
        return {
          ...base,
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Resource not found',
          error: 'Not Found',
          code: ErrorCodes.NotFound,
        };
      default:
        return {
          ...base,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          error: 'Internal Server Error',
          code: ErrorCodes.Unknown,
        };
    }
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCodes.Unauthorized;
      case HttpStatus.FORBIDDEN:
        return ErrorCodes.Forbidden;
      case HttpStatus.NOT_FOUND:
        return ErrorCodes.NotFound;
      case HttpStatus.CONFLICT:
        return ErrorCodes.Conflict;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCodes.RateLimited;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCodes.ValidationFailed;
      default:
        return ErrorCodes.Unknown;
    }
  }
}
