# Authentication flow

```
┌──────────────┐                ┌──────────────┐                ┌──────────────┐
│  Mobile app  │                │ Supabase Auth│                │  IncaCook API │
└──────┬───────┘                └──────┬───────┘                └──────┬───────┘
       │  signInWithPassword           │                               │
       ├──────────────────────────────►│                               │
       │                               │                               │
       │  { access_token, refresh… }   │                               │
       │◄──────────────────────────────┤                               │
       │                               │                               │
       │  Authorization: Bearer <jwt>                                  │
       ├──────────────────────────────────────────────────────────────►│
       │                                                               │
       │                                                ┌─────────────┐│
       │                                                │ JwtStrategy ││
       │                                                │ verifies w/ ││
       │                                                │ SUPABASE_   ││
       │                                                │ JWT_SECRET  ││
       │                                                └─────────────┘│
       │                                                               │
       │  200 OK { data… }                                             │
       │◄──────────────────────────────────────────────────────────────┤
```

## Token lifecycle

- The mobile app uses the Supabase JS SDK to sign in / sign up.
- Supabase returns an access token (JWT, 1h TTL) and a refresh token. The app refreshes silently before expiration.
- Every API call includes `Authorization: Bearer <access_token>`.
- The backend verifies the signature against `SUPABASE_JWT_SECRET` (same secret Supabase signs with).
- Successful verification produces an `AuthenticatedUser = { id, email?, phone?, role }` attached to `request.user`.

## Public routes

Mark public routes (e.g. health, webhook receivers) with `@Public()`:

```ts
import { Public } from '@common/decorators/public.decorator';

@Public()
@Get('health')
health() { … }
```

## Roles

`UserRole` (Buyer / Seller / Driver / Admin / Moderator) is read from the JWT custom claim `role`. The `RolesGuard` plus `@Roles(...)` decorator enforces it on a per-route basis.

## Server-side admin actions

Privileged actions (banning users, force-cancelling orders) use the Supabase service role via `SupabaseAdminService`. These bypass RLS and must always be paired with an `AuditService.log()` call.
