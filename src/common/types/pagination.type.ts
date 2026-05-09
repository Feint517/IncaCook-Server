export interface CursorPagination {
  limit: number;
  cursor?: string;
}

export interface OffsetPagination {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total?: number;
  nextCursor?: string;
  hasMore: boolean;
}
