# Flutter integration guide

Everything the Flutter app needs to talk to the IncaCook backend. The app
**only talks to this backend** — it never calls Supabase directly. Single
base URL, single auth surface.

For deeper specifications:
- [`api-conventions.md`](./api-conventions.md) — versioning, idempotency, pagination conventions
- [`error-codes.md`](./error-codes.md) — full `INCACOOK_*` taxonomy
- [`local-testing.md`](./local-testing.md) — running the backend + Supabase stack locally

---

## 1. Base URL

| Environment | Base URL | Notes |
|---|---|---|
| Local — iOS simulator | `http://127.0.0.1:3001` | Simulator shares host loopback |
| Local — Android emulator | `http://10.0.2.2:3001` | Emulator-only alias for host loopback |
| Local — physical device on Wi-Fi | `http://<your-LAN-IP>:3001` | e.g. `http://192.168.1.42:3001` |
| Staging / Prod | TBD | Inject via `--dart-define` at build time |

All routes are prefixed with `/v1/`. Versioning is via URI segment — when we
ship breaking changes, we'll mount `/v2/` in parallel.

> **Port 3001, not 3000.** The local backend listens on 3001 because the
> UrbanFlow backend already binds 3000 on the shared dev machine
> (see [`local-testing.md`](./local-testing.md)). Production will go
> back to a normal hostname so this won't surface in built apps —
> only the local-dev base URL needs to know.

```dart
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3001',
);
```

---

## 2. Response envelopes

### Success — `2xx`

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-05-12T14:23:45.123Z",
    "version": "v1"
  },
  "pagination": {
    "hasMore": false,
    "total": 12,
    "nextCursor": null,
    "page": null,
    "limit": null
  }
}
```

`pagination` is only present on list endpoints. The shape of `data` is per
endpoint — for paginated lists it's an array; for everything else it's a
single object.

### Error — `4xx` / `5xx`

```json
{
  "success": false,
  "error": {
    "statusCode": 409,
    "message": "Order is in PREPARING; cancellation is allowed from CONFIRMED",
    "error": "Conflict",
    "code": "INCACOOK_CONFLICT",
    "timestamp": "2026-05-12T14:23:45.123Z",
    "path": "/v1/orders/01K.../cancel",
    "correlationId": "01K..."
  }
}
```

**Always show `correlationId` in error UI** — users quote it to support and
it lets us find the request in logs / Sentry instantly.

**Branch on `error.code`, never on `error.message`** — messages may change,
codes are stable. See [`error-codes.md`](./error-codes.md) for the catalog.

### Dart model

```dart
sealed class ApiResponse<T> {
  const ApiResponse();
}

class ApiSuccess<T> extends ApiResponse<T> {
  final T data;
  final Pagination? pagination;
  const ApiSuccess(this.data, {this.pagination});
}

class ApiFailure extends ApiResponse<Never> {
  final int statusCode;
  final String message;
  final String code;            // INCACOOK_*
  final String? correlationId;
  final dynamic details;
  const ApiFailure({
    required this.statusCode,
    required this.message,
    required this.code,
    this.correlationId,
    this.details,
  });
}

class Pagination {
  final bool? hasMore;
  final int? total;
  final String? nextCursor;
  final int? page;
  final int? limit;
  const Pagination({this.hasMore, this.total, this.nextCursor, this.page, this.limit});
}
```

---

## 3. HTTP status codes

| Status | When you'll see it |
|---|---|
| `200` OK | Reads, state transitions, signin, refresh |
| `201` Created | New resource (signup, create order, create listing) |
| `204` No Content | Mutation without a body (signout, password update, bookmark, cancel) |
| `400` Bad Request | Validation, malformed body, weak password, missing required header |
| `401` Unauthorized | Missing / invalid / tampered / expired JWT, wrong credentials |
| `403` Forbidden | Authenticated but wrong role, or not the resource owner |
| `404` Not Found | Resource doesn't exist (or we hide existence to avoid leaks) |
| `409` Conflict | Duplicate create, idempotency-key reused with different body, invalid state transition |
| `422` Unprocessable Entity | Business-rule failure (`LISTING_EXPIRED`, `INSUFFICIENT_STOCK`, etc.) |
| `429` Too Many Requests | Rate limit |
| `5xx` | Server-side bug — show generic error + correlation ID |

Map these to Flutter UX:
- `401` → silently call `/auth/refresh`, retry once; on second `401` boot the user to the signin screen
- `403` → "you don't have access" toast
- `404` → resource-specific empty state
- `409` and `422` → show `error.message` to the user (they're human-readable)
- `429` → "slow down" toast + exponential backoff
- `5xx` → generic "something went wrong, [correlationId]" + retry button

---

## 4. Auth flow

### Endpoint catalog

All under `/v1/auth/*`. Public endpoints don't need an `Authorization` header.

| Endpoint | Auth | Body | Returns | Status |
|---|---|---|---|---|
| `POST /auth/signup` | public | `{ email, password }` | session | 201 |
| `POST /auth/signin` | public | `{ email, password }` | session | 200 |
| `POST /auth/refresh` | public (refreshToken in body) | `{ refreshToken }` | session | 200 |
| `POST /auth/signout?scope=local\|global` | Bearer | — | — | 204 |
| `POST /auth/password/reset-request` | public | `{ email, redirectTo? }` | — | 204 |
| `POST /auth/password/update` | Bearer | `{ newPassword }` | — | 204 |

### Session shape

```json
{
  "accessToken": "eyJhbGciOiJFUzI1NiIsImtpZCI6Ii4uLiJ9...",
  "refreshToken": "v1...",
  "expiresAt": 1778601278,
  "user": {
    "id": "uuid-v4",
    "email": "user@example.com",
    "phone": null,
    "emailConfirmedAt": "2026-05-12T...",
    "phoneConfirmedAt": null
  }
}
```

`expiresAt` is a Unix-seconds timestamp. The access token's TTL is **1 hour**.
The refresh token lives until you explicitly sign out (`scope=global` kills
all sessions; `local` kills only this device's refresh token).

### Full lifecycle

```
1. signup     ─►  store tokens
2. POST /v1/users  ─►  complete profile (firstName/lastName/role/CGU/CGV)
                       returns the IncaCook User row
3. ...normal app activity, every request carries the access token...
4. when access token nears expiry (e.g. <60s left) OR a request returns 401:
     ─►  refresh, swap stored tokens, retry the original request once
5. signout    ─►  delete stored tokens locally
```

The "complete profile" step (`POST /v1/users`) is separate from `signup`
because role + profile fields are collected on later signup screens. The
JWT from `signup` is used to authenticate that follow-up call.

### Token storage

Use `flutter_secure_storage` (Keychain on iOS, EncryptedSharedPreferences on
Android). Never store tokens in `SharedPreferences` or memory only.

```dart
final storage = const FlutterSecureStorage();
await storage.write(key: 'access_token', value: session.accessToken);
await storage.write(key: 'refresh_token', value: session.refreshToken);
```

### Auth header

```
Authorization: Bearer <accessToken>
```

### Refresh interceptor (dio)

```dart
class AuthInterceptor extends Interceptor {
  final TokenStorage storage;
  final Dio dio;
  bool _refreshing = false;
  final List<RequestOptions> _queue = [];

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler h) async {
    final token = await storage.read('access_token');
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    h.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler h) async {
    final status = err.response?.statusCode;
    final retried = err.requestOptions.extra['retried'] == true;
    if (status != 401 || retried) return h.next(err);

    // Single-flight: queue concurrent 401s while one refresh runs.
    if (_refreshing) {
      _queue.add(err.requestOptions);
      return;
    }
    _refreshing = true;

    try {
      final rt = await storage.read('refresh_token');
      if (rt == null) throw _signOut();
      final resp = await Dio().post(
        '${dio.options.baseUrl}/v1/auth/refresh',
        data: {'refreshToken': rt},
      );
      final body = resp.data['data'];
      await storage.write('access_token', body['accessToken']);
      await storage.write('refresh_token', body['refreshToken']);

      // Replay original + queued requests.
      err.requestOptions.extra['retried'] = true;
      err.requestOptions.headers['Authorization'] = 'Bearer ${body['accessToken']}';
      final result = await dio.fetch(err.requestOptions);
      for (final r in _queue) {
        r.extra['retried'] = true;
        r.headers['Authorization'] = 'Bearer ${body['accessToken']}';
        unawaited(dio.fetch(r));
      }
      _queue.clear();
      return h.resolve(result);
    } catch (_) {
      _signOut();
      return h.reject(err);
    } finally {
      _refreshing = false;
    }
  }

  Never _signOut() {
    // Clear tokens + navigate to signin. Implementation depends on your
    // router; throw something AuthInterceptor.onError can catch.
    throw Exception('signed-out');
  }
}
```

### Password reset deep link

`POST /auth/password/reset-request` triggers Supabase to email a magic link.
Supabase appends the recovery JWT as a URL fragment on the `redirectTo`
value. Configure the Flutter app to handle deep links of the form:

```
incacook://auth/recover#access_token=...&expires_at=...&refresh_token=...&token_type=bearer&type=recovery
```

In Flutter, parse the fragment, store the tokens, navigate to a "set new
password" screen, then call `POST /v1/auth/password/update` with the new
password and the recovery access token as the Bearer.

---

## 5. Idempotency

Mutating requests that create resources or move money **must** include an
`Idempotency-Key` header. Replaying the same key with the same body returns
the original response; same key with a different body returns `409`.

```
Idempotency-Key: <ULID>
```

Generate a fresh key per user action (e.g. tap of "Place Order"). The key
is good for 24 hours.

```dart
import 'package:ulid/ulid.dart';

dio.post(
  '/v1/orders',
  data: orderPayload,
  options: Options(headers: {'Idempotency-Key': Ulid().toString()}),
);
```

Endpoints that require it today:
- `POST /v1/orders` (place order)
- Any `POST` that calls Stripe (escrow, withdrawals)

Missing it on a required endpoint → `400`.

---

## 6. Correlation IDs

Every response carries one in the `error.correlationId` field (on errors)
or you can read it from the `x-correlation-id` response header on
successes. It's a ULID, assigned by the backend per request.

**Show it in any error toast / screen.** Users quote it to support, we grep
logs by it.

---

## 7. Pagination

Two styles depending on endpoint. See per-endpoint docs. The interceptor
auto-detects pagination if the controller returns `{ items, hasMore?, total?,
nextCursor?, page?, limit? }`:

### Cursor (used for feeds, infinite scroll)

Request:
```
GET /v1/listings?limit=20&cursor=<opaque>
```

Response:
```json
{
  "success": true,
  "data": [ /* items */ ],
  "pagination": { "hasMore": true, "nextCursor": "abc123" }
}
```

Use `nextCursor` for the next page. Stop when `hasMore` is false.

### Offset (used for admin / moderation lists)

Request:
```
GET /v1/admin/kyc?page=1&limit=20
```

Response:
```json
{
  "success": true,
  "data": [ /* items */ ],
  "pagination": { "page": 1, "limit": 20, "total": 47, "hasMore": true }
}
```

Defaults: `limit=20`, max `limit=100`.

---

## 8. Rate limiting

Every response (success or error) includes:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1715170800
```

On a `429`, back off with jitter — start at 1s, double per failure, cap at
30s. Show "try again in N seconds" UI based on `X-RateLimit-Reset`.

---

## 9. Common pitfalls

- **Forgetting `Content-Type: application/json`** — dio adds it by default
  for `data: Map`, but raw strings won't.
- **Showing `error.message` directly** for `5xx` — these are often internal
  ("Database error"). Use a generic copy and include the correlation ID.
- **Storing tokens in `SharedPreferences`** — not secure on root/jailbroken
  devices. Always `flutter_secure_storage`.
- **Refreshing on every 401** without single-flight protection — a burst of
  10 parallel requests after expiry will fire 10 refreshes, racing each
  other and burning the refresh token. The interceptor above queues
  concurrent attempts.
- **Calling Supabase directly** — there's no longer a reason to. The
  backend is the only auth surface. If you find yourself reaching for
  `supabase_flutter`, stop.

---

## 10. Where to look next

- New endpoint surface? Check the relevant controller in
  `src/modules/<feature>/<feature>.controller.ts` — endpoints are
  self-documenting via decorators.
- New `INCACOOK_*` code? Add it to
  `src/common/constants/error-codes.constants.ts` and document it in
  [`error-codes.md`](./error-codes.md).
- Auth questions? [`auth-flow.md`](./auth-flow.md) (note: that doc is
  currently stale and describes the old direct-Supabase flow — needs a
  rewrite to match the backend-only model documented here).
