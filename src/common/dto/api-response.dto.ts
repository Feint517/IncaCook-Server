/**
 * Mirrors the shape produced by TransformInterceptor — useful for documenting
 * controller return types.
 */
export interface ApiResponseDto<T> {
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

export interface ApiErrorResponseDto {
  success: false;
  error: {
    statusCode: number;
    message: string;
    error: string;
    code: string;
    timestamp: string;
    path: string;
    correlationId?: string;
    details?: unknown;
  };
}
