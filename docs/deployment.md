# Deployment

## Targets

- **API service** (HTTP, port 3000) — deployed to Railway/Render/Fly. Long-lived Node 22 container.
- **Worker service** (no HTTP) — same image, started with `node dist/worker.js`. Scaled independently.

## Build

The Dockerfile is multi-stage:

1. `deps` — installs production+dev dependencies with the frozen lockfile.
2. `build` — runs `pnpm prisma:generate && pnpm build`.
3. `runtime` — slim `node:22-alpine` image with `dist/`, `prisma/`, `node_modules/`. Runs as non-root `incacook`.

A `HEALTHCHECK` hits `/v1/health` every 30s.

## Environment

Provision env from your platform's secrets store. The full surface is documented in `.env.example`. **Never** commit `.env`.

Required for any environment: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REDIS_URL`.

## Migrations

Run on every deploy, before booting the new image:

```bash
pnpm prisma:migrate:deploy
```

Migrations are forward-only. To roll back, ship a compensating migration.

## Cutover

The two services share the same image:

```
release:
  before:
    - pnpm prisma:migrate:deploy
  api:
    cmd: node dist/main.js
    instances: 2
  worker:
    cmd: node dist/worker.js
    instances: 1
```

## Observability

- Logs: structured JSON via Pino → platform log drain.
- Errors (5xx): Sentry, only when `NODE_ENV=production` and `SENTRY_DSN` is set.
- Health: `/v1/health` (liveness), `/v1/health/ready` (DB + Redis). Wire to platform health probes.
