# IncaCook API

Backend API for **IncaCook**, an anti-food-waste local food marketplace serving home cooks (Le Bon Fait Maison), traiteurs (L'Atelier Traiteur), and restaurants (Sauve Ton Panier), with independent delivery drivers.

This service is the **only** consumer of the Supabase service role key. The mobile app talks exclusively to this API.

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5.7 |
| Framework | NestJS 11 |
| Database | Supabase Postgres + PostGIS |
| ORM | Prisma 6 |
| Auth | Supabase Auth (JWT validated by NestJS) |
| Queue & cache | Redis + BullMQ |
| Realtime | Socket.io |
| Payments | Stripe Connect |
| Push / SMS / Email | Firebase FCM, Twilio, Resend |
| Geocoding | Mapbox |
| Logging / monitoring | Pino, Sentry |
| Testing | Vitest + Supertest |

---

## Prerequisites

- Node.js **>= 22**
- pnpm **>= 9** (this repo uses `corepack`-pinned `pnpm@9.15.0`)
- Redis and Mailhog (local via `docker compose up -d`)
- Supabase CLI (local via `npx supabase start`)

---

## Getting started

```bash
# 1. Install
pnpm install

# 2. Configure
cp .env.example .env
# Fill in required values (DATABASE_URL, SUPABASE_*, STRIPE_*, JWT_SECRET ...)

# 3. Boot infra (Redis, Mailhog, and Supabase)
pnpm start:services

# 4. Generate Prisma client (no models yet — runs cleanly)
pnpm prisma:generate

# 5. Run
pnpm start:dev
```

Once running, hit `http://localhost:3000/v1/health`.

---

## Available scripts

| Script | Purpose |
|---|---|
| `pnpm start` | Run compiled app |
| `pnpm start:services` | Start local Redis, Mailhog, and Supabase containers |
| `pnpm stop:services` | Stop local Redis, Mailhog, and Supabase containers |
| `pnpm start:dev` | Hot-reloading dev server |
| `pnpm start:debug` | Dev server with `--inspect` |
| `pnpm start:prod` | Run compiled API (`node dist/main.js`) |
| `pnpm start:worker:dev` | BullMQ worker process (dev) |
| `pnpm start:worker` | Run compiled worker (`node dist/worker.js`) — durable timers |
| `pnpm build` | Compile to `dist/` |
| `pnpm lint` / `pnpm lint:check` | ESLint (autofix / check-only) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Vitest end-to-end tests |
| `pnpm prisma:migrate:dev` | Apply migration locally |
| `pnpm prisma:studio` | Inspect DB |

---

## Durable business timers (BullMQ worker)

Several business rules are time-delayed. Each is armed as an **in-process timer**
(survives only while the process runs) **and** mirrored as a **durable BullMQ
job** (survives an API restart). Run the **worker** to process them:

```bash
pnpm start:worker        # production (node dist/worker.js)
pnpm start:worker:dev    # dev (watch)
```

In production run the API **and** the worker. In dev you can run only the API —
durable jobs queue until a worker runs, and the in-process timers cover the
no-restart case.

| Timer | Durable BullMQ job | Idempotent handler |
|---|---|---|
| No driver after `NO_DRIVER_TIMEOUT_MINUTES` (default 15) | `no_driver_timeout` | `OrdersService.handleNoDriverTimeout` |
| Buyer no-response after `NO_DRIVER_BUYER_RESPONSE_MINUTES` (default 10) | `no_driver_buyer_response_timeout` | `OrdersService.autoCancelNoResponse` |
| Driver disappeared after `DRIVER_DELIVERY_TIMEOUT_MINUTES` (default 60) | `driver_delivery_timeout` | `OrdersService.handleDriverDeliveryTimeout` |
| Wallet pending release (`WALLET_RELEASE_HOURS`, default 24) | `wallet_release_sweep` (repeatable, 5 min) | `WalletService.releaseDuePendingEntries` |

- Processors (`src/jobs/*.processor.ts`) only call the existing idempotent
  service methods — **no business logic is duplicated**.
- The in-process timer and the BullMQ job may both fire; this is safe (no double
  refund / cancel / pay / strike).
- If Redis is down, the API still starts; enqueue failures log
  `[Jobs] fallback in-process timer scheduled …` and the in-process timer is the
  fallback.
- Job lifecycle logs: `[Jobs] scheduled|processing|completed|failed name=… id=…`.

**Required Redis env** (already used by BullMQ + pub/sub):

```bash
REDIS_URL=redis://localhost:6379    # or REDIS_HOST / REDIS_PORT / REDIS_PASSWORD
```

---

## Folder layout

```
src/
  config/           Typed env config slices
  common/           Cross-cutting: filters, guards, interceptors, DTOs, enums
  infrastructure/   Adapters: Prisma, Redis, BullMQ, Supabase, Stripe, FCM…
  modules/          Domain modules (auth, orders, listings, payments, …)
  jobs/             BullMQ processors and cron schedulers
  main.ts           HTTP entrypoint
  worker.ts         Worker entrypoint (no HTTP server)
prisma/             Prisma schema and seeds
test/               Vitest unit + e2e harness
docs/               Architecture and conventions
```

See [docs/architecture.md](./docs/architecture.md) for the layered architecture and module-boundary rules.

---

## Architecture principles

1. API-first — mobile never calls Supabase directly
2. Modular monolith with layered modules (Controller → Service → Repository)
3. Domain-driven folder names
4. Versioned API: every route lives under `/v1/`
5. Idempotency-by-default for mutating endpoints
6. Audit logging on every state-changing operation

---

## Contributing

- Use feature branches off `develop`
- Pre-commit hooks run `lint-staged` (ESLint + Prettier)
- CI runs lint, format, typecheck, test, and build
- See [docs/api-conventions.md](./docs/api-conventions.md) for response shape and pagination rules
