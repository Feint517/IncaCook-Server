# API conventions

## Versioning

All routes are prefixed with `/v1/`. Versioning is declared via NestJS `enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`.

When a breaking change ships, mount a parallel `/v2/` and deprecate `/v1/` per the deprecation policy.

## Authentication

```
Authorization: Bearer <Supabase JWT>
```

Routes are authenticated by default (`JwtAuthGuard` is global). Mark a route as public with the `@Public()` decorator.

## Idempotency

All `POST` / `PATCH` / `PUT` requests that produce side effects must accept an `Idempotency-Key` header. The backend stores the response keyed on `(user_id, idempotency_key)` for 24h.

```
Idempotency-Key: <ULID>
```

## Pagination

| Use case | Style | Query params |
|---|---|---|
| Public feeds (listings, search) | Cursor | `?limit=20&cursor=<opaque>` |
| Admin / moderation listings | Offset | `?page=1&limit=20` |

Defaults: `limit=20`, max `limit=100`. Defined in `BusinessRules`.

## Standard response shape

Successful responses pass through `TransformInterceptor`:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-05-08T12:00:00.000Z",
    "version": "v1"
  },
  "pagination": {
    "nextCursor": "abc123",
    "hasMore": true
  }
}
```

Error responses pass through `AllExceptionsFilter`:

```json
{
  "success": false,
  "error": {
    "statusCode": 422,
    "message": "Listing has expired",
    "error": "Unprocessable Entity",
    "code": "INCACOOK_LISTING_EXPIRED",
    "timestamp": "2026-05-08T12:00:00.000Z",
    "path": "/v1/orders",
    "correlationId": "01HX…"
  }
}
```

## Rate-limit headers

Every response includes:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1715170800
```

## Routes

- Plural resource names: `/v1/listings`, `/v1/orders`
- Sub-resources: `/v1/sellers/:id/listings`
- Verbs as POST actions: `/v1/orders/:id/accept`, `/v1/listings/:id/boost`
- Filter via query params: `/v1/listings?cuisine=french&dietary=halal`
