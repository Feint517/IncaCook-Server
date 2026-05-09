# Architecture

## API-first principle

The mobile client **never** talks to Supabase directly. The Supabase service-role key lives only in this backend. The mobile app authenticates against Supabase Auth, receives a JWT, and sends every request to NestJS — which validates the JWT and enforces business rules before touching the database.

```
                            ┌────────────────────────┐
                            │      Mobile app        │
                            │ (Expo + Supabase Auth) │
                            └───────────┬────────────┘
                                        │ Bearer JWT
                                        ▼
   ┌───────────────────────────────────────────────────────────────┐
   │                     IncaCook API (NestJS)                      │
   │ ┌──────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐ │
   │ │  Auth    │  │ Domain     │  │ Pipelines  │  │ Background  │ │
   │ │ (JWT)    │  │ modules    │  │ (filters,  │  │ workers     │ │
   │ └──────────┘  │            │  │  guards,   │  │ (BullMQ)    │ │
   │               │ orders,    │  │  pipes)    │  │             │ │
   │               │ listings,  │  │            │  │             │ │
   │               │ payments…  │  │            │  │             │ │
   │               └────────────┘  └────────────┘  └─────────────┘ │
   └─────────┬───────────┬───────────┬───────────┬─────────────────┘
             │           │           │           │
             ▼           ▼           ▼           ▼
        ┌────────┐  ┌─────────┐  ┌────────┐  ┌────────┐
        │Postgres│  │  Redis  │  │ Stripe │  │ FCM /  │
        │(Supab.)│  │  (BullMQ│  │Connect │  │ Twilio │
        │ +PostGIS│ │  cache) │  │        │  │ /Resend│
        └────────┘  └─────────┘  └────────┘  └────────┘
```

## Layered modules

Every feature module follows the same layering:

- **Controller** — HTTP only (parsing, validation, response shaping).
- **Service** — orchestration and business rules. Calls repositories, queues, integrations.
- **Repository** — sole owner of Prisma/Supabase calls for that domain.

No raw Prisma or Supabase calls exist in services. No business logic lives in controllers.

## Cross-cutting concerns

| Concern | Owner |
|---|---|
| Validation | `ZodValidationPipe`, class-validator decorators |
| Errors | `AllExceptionsFilter` produces a uniform `{ success: false, error: {...} }` |
| Correlation IDs | `CorrelationIdMiddleware` (header `X-Correlation-Id`) |
| Logging | Pino via `nestjs-pino`, redacted secrets, structured JSON in prod |
| Audit | `AuditService.log()` from interceptors and services |
| Throttling | `IncaCookThrottleGuard` keyed by user ID |
| Sentry | Initialized in `main.ts` and used by the global exception filter |

## Why a modular monolith?

Microservices buy independent deploys and team autonomy at the cost of distributed-systems complexity. At the launch scale of IncaCook (hundreds of orders/day, single-team ownership), the cost is not justified. The boundaries inside `src/modules/` are explicit enough that any module can graduate to a service later.

## Worker process

`src/worker.ts` boots the same NestJS DI container without an HTTP listener and only loads `JobsModule` plus its infra dependencies. This lets us scale the API and worker independently in production.
