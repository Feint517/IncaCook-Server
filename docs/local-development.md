# Local development

End-to-end reference for running the IncaCook server against a fully
local Supabase stack — first-time setup, daily workflow, stack
internals, and troubleshooting. Covers both regular development and
manual / integration testing.

> The local stack uses well-known default credentials (anon key,
> service role key, JWT secret) that ship with the Supabase CLI. They
> are public knowledge — never reuse them in production.

> **Ports are remapped from Supabase defaults.** IncaCook coexists on
> this machine with the UrbanFlow project, which already binds the
> defaults (54321-54324, 6379). To avoid clashes, IncaCook uses
> **54331-54334** + 54337 for Supabase, **6380** for Redis, and
> **3001** for the Nest API. `.env.test` is already wired to these.

---

## 1. Overview

The local stack is split across **two independent Docker Compose
projects** that run side by side. They look like one stack from the
app's perspective but live under separate Compose project labels:

| Project | Owner | Purpose |
|---|---|---|
| `incacook-supabase` | Supabase CLI ([supabase/config.toml](../supabase/config.toml)) | Full Supabase BaaS: Postgres, auth, REST, storage, realtime, studio, mail, analytics |
| `incacook-services` | Local [docker-compose.yml](../docker-compose.yml) | The app's auxiliary services (currently: Redis) |

They can't be merged into a single Compose project — the Supabase CLI
manages its own internal compose stack, and Compose v2 normalizes
project names to lowercase whereas the Supabase CLI does not, so the
two label spaces will never align. The naming convention above keeps
them visually distinct in Docker Desktop.

---

## 2. Prerequisites

| Tool | Min version | Install |
|---|---|---|
| **Docker Desktop** | running | https://www.docker.com/products/docker-desktop |
| **Supabase CLI** | 2.x | `brew install supabase/tap/supabase` |
| **Node.js** | 22+ | `nvm install 22` (project pins via `.nvmrc`) |
| **pnpm** | 9+ | `corepack enable pnpm` |

Verify:
```bash
docker ps          # no error → daemon is up
supabase --version
node --version
pnpm --version
```

---

## 3. Quick start

Already set up once before? Just:

```bash
pnpm start:services     # boots both stacks (idempotent)
pnpm test:start:dev     # boots the Nest API with .env.test
```

The API is now listening on http://localhost:3001 against the local
Supabase + Redis. If this is your first time, follow [§4](#4-first-time-setup) instead.

---

## 4. First-time setup

Run these once after cloning the repo (or after a fresh machine).

### 4.1 Install Node dependencies

```bash
pnpm install
```

### 4.2 Boot the local stacks

The `supabase/` config is committed to the repo (created via `supabase
init`). First boot downloads ~3 GB of Docker images and takes several
minutes.

```bash
pnpm start:services
```

This runs `docker compose up -d` (Redis) then `npx supabase start`
(Supabase). `supabase status -o env` prints the credentials — the
local defaults already live in `.env.test`, so you don't normally need
to look at that output again.

### 4.3 Create `.env.test`

The file is gitignored. If you don't have one yet, copy the template
from [§11](#11-envtest-template).

`.env.test` already points at the local Supabase stack. The
Stripe-related values are placeholders; fill them with real
**test-mode** Stripe keys when you want to exercise payment flows.

### 4.4 Apply all migrations to the local DB

```bash
pnpm test:db:migrate
```

This applies every migration in `prisma/migrations/` to the local
Postgres on port `54332`.

### 4.5 Create the four Storage buckets

The local Supabase ships without buckets. The app references `avatars`,
`listings`, `kyc`, and `seller-facades`. Create them once:

```bash
docker exec supabase_db_incacook-supabase psql -U postgres -d postgres -c "
INSERT INTO storage.buckets (id, name, public) VALUES
  ('avatars',         'avatars',         true),
  ('listings',        'listings',        true),
  ('kyc',             'kyc',             false),
  ('seller-facades',  'seller-facades',  true)
ON CONFLICT (id) DO NOTHING;"
```

Storage RLS policies for these buckets came in via migrations and are
already attached.

### 4.6 Seed test data

```bash
pnpm test:db:seed
```

Creates:

| User | Role | supabaseId | Notes |
|---|---|---|---|
| `test+admin@incacook.test` | ADMIN | `00000000-...-001` | |
| `test+buyer@incacook.test` | BUYER | `00000000-...-002` | Default address: Bastille, Paris 11 |
| `test+seller@incacook.test` | SELLER | `00000000-...-003` | FAIT_MAISON, auto-approved KYC, 3 listings |
| `test+driver@incacook.test` | DRIVER | `00000000-...-004` | KYC=APPROVED, BICYCLE, online |

The seed is idempotent — re-running wipes and recreates these four
users (and their related rows) without touching anything else.

---

## 5. Daily workflow

### 5.1 Bring everything up

```bash
pnpm start:services            # idempotent — no-ops if already running
pnpm test:start:dev            # API with .env.test
```

The server is now listening on http://localhost:3001 with `.env.test`
loaded.

### 5.2 Mint test JWTs

```bash
TOKEN=$(pnpm -s test:mint-jwt buyer)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/v1/users/me

# Other roles:
pnpm -s test:mint-jwt admin
pnpm -s test:mint-jwt seller
pnpm -s test:mint-jwt driver
```

Tokens are signed with the **local** Supabase JWT secret and last 24 h.
Don't mix them with tokens minted against `.env` (those use the remote
secret).

#### Live signup-flow test accounts

Separate from the four seeded `test+role@incacook.test` users, three
real-email accounts are reserved for end-to-end signup testing (so the
flow exercises `POST /v1/auth/signup` rather than the seeder's direct
inserts). Credentials live in the gitignored
[`test-accounts.local.md`](../test-accounts.local.md). The Mailpit
inbox at http://127.0.0.1:54334 catches the OTP emails — no real Gmail
delivery.

### 5.3 Verify the phone gate via email OTP (temporary bypass)

While the SMS provider is unavailable, `POST /v1/auth/email/request-otp`
+ `POST /v1/auth/email/verify` flip `User.phoneVerified` using an email
code instead of an SMS code. See [signup-flow.md §3.9](signup-flow.md#39-post-v1authphoneverify--bearer)
for the API.

Locally:

```bash
TOKEN=$(pnpm -s test:mint-jwt seller)
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/v1/auth/email/request-otp
# → 204; the 6-digit code lands in Mailpit (see §5.4) for the test
#   account's email. Copy it, then:
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}' \
  http://localhost:3001/v1/auth/email/verify
```

The Mailpit inbox at http://127.0.0.1:54334 catches all Supabase auth
emails — no real send. Codes expire after a few minutes.

### 5.4 Browse the local Postgres / Storage

- **Supabase Studio**: http://127.0.0.1:54333 — DB browser, storage UI
- **Mailpit**: http://127.0.0.1:54334 — local email inbox
- **Prisma Studio**: `pnpm prisma:studio` (against whichever env's
  `DATABASE_URL` is set; for test env prefix with `dotenv -e .env.test --`)

### 5.5 Reset state between tests

Two flavours:

```bash
# Fast — drops + recreates the public schema only
pnpm test:db:reset                         # `prisma migrate reset --force`

# Heavier — also resets storage, auth tables, etc.
supabase db reset                          # rebuilds the whole Supabase DB
pnpm test:db:migrate
# Re-create buckets (see §4.5)
pnpm test:db:seed
```

For most testing iterations `pnpm test:db:reset && pnpm test:db:seed`
is all you need.

---

## 6. Stack reference

### 6.1 Containers

#### `incacook-supabase` (12 containers, all prefixed `supabase_*`)

| Container | Image | Role |
|---|---|---|
| `supabase_db_incacook-supabase` | `supabase/postgres:17.x` | Postgres database |
| `supabase_kong_incacook-supabase` | `supabase/kong` | API gateway (entrypoint for everything else) |
| `supabase_auth_incacook-supabase` | `supabase/gotrue` | Auth service (GoTrue) |
| `supabase_rest_incacook-supabase` | `supabase/postgrest` | Auto-generated REST API |
| `supabase_realtime_incacook-supabase` | `supabase/realtime` | Realtime subscriptions over WS |
| `supabase_storage_incacook-supabase` | `supabase/storage-api` | S3-compatible object storage |
| `supabase_studio_incacook-supabase` | `supabase/studio` | Web dashboard |
| `supabase_pg_meta_incacook-supabase` | `supabase/postgres-meta` | Backs Studio's schema browser |
| `supabase_edge_runtime_incacook-supabase` | `supabase/edge-runtime` | Local Edge Functions runtime |
| `supabase_inbucket_incacook-supabase` | `supabase/mailpit` | Captures outgoing email (auth confirmations etc.) |
| `supabase_analytics_incacook-supabase` | `supabase/logflare` | Studio logs/analytics |
| `supabase_vector_incacook-supabase` | `supabase/vector` | Log shipper into analytics |

#### `incacook-services`

| Container | Image | Role |
|---|---|---|
| `incacook-redis` | `redis:7-alpine` | Cache + BullMQ queue backend |

### 6.2 Ports

| Service | IncaCook | Supabase default | URL |
|---|---|---|---|
| Supabase API (Kong) | 54331 | 54321 | http://127.0.0.1:54331 |
| Postgres | 54332 | 54322 | `postgresql://postgres:postgres@127.0.0.1:54332/postgres` |
| Studio | 54333 | 54323 | http://127.0.0.1:54333 |
| Mailpit (Inbucket) | 54334 | 54324 | http://127.0.0.1:54334 |
| Analytics | 54337 | 54327 | http://127.0.0.1:54337 |
| Redis | 6380 | 6379 | `redis://127.0.0.1:6380` |
| Nest API (dev) | 3001 | — | http://127.0.0.1:3001 |

### 6.3 Volumes

Persistent state lives in three named volumes. Everything else
(realtime, kong, gotrue, edge-runtime, etc.) is stateless and recreated
on start.

| Volume | Stack | Contains |
|---|---|---|
| `supabase_db_incacook-supabase` | supabase | Full Postgres data dir (`public.*`, `auth.*`, `storage.*`, migrations, seeds) |
| `supabase_storage_incacook-supabase` | supabase | Uploaded objects (Supabase Storage backing store) |
| `incacook-services_incacook-redis-data` | services | Redis AOF/RDB (cache + queue state) |

Volume naming follows `<compose-project>_<volume-name>` for the
services stack, and `supabase_<service>_<project_id>` for the Supabase
CLI. Renaming the compose project name or `project_id` mints fresh
volumes — see [§8 Renaming the stack](#8-renaming-the-stack).

---

## 7. Stopping & teardown

### 7.1 Stop the API server

```bash
# In the terminal running `pnpm test:start:dev`, press Ctrl+C.
# If it's in the background:
pkill -f "nest start --watch"
```

### 7.2 Stop both stacks (keep data)

```bash
pnpm stop:services
```

This runs `docker compose down` (removes the Redis container, keeps
its volume) then `supabase stop` (stops the Supabase containers, keeps
all volumes). Next `pnpm start:services` resumes with all seeded data
intact.

### 7.3 Wipe Postgres without touching anything else

```bash
supabase db reset
# Re-create buckets (§4.5), then re-seed
pnpm test:db:seed
```

### 7.4 Wipe Redis

```bash
docker exec incacook-redis redis-cli FLUSHALL
```

### 7.5 Full teardown (rare — only when freeing disk space)

```bash
pkill -f "nest start --watch"               # API
supabase stop --no-backup                   # Supabase + DB volume
docker compose down -v                      # incacook-redis + its data volume

# To also remove the Supabase Docker images (~3 GB) — note: shared with
# other Supabase projects on this machine, removing affects them too:
docker images | grep supabase | awk '{print $3}' | xargs docker rmi
```

---

## 8. Renaming the stack

If you ever need to rename `project_id` or the compose `name:`, the
volumes are keyed by those names and **will not migrate automatically**.
The procedure that preserves data:

1. `pnpm stop:services`
2. For each existing volume, create a new one and copy data:
   ```bash
   docker volume create <new-name>
   docker run --rm -v <old-name>:/from:ro -v <new-name>:/to alpine \
     sh -c 'cp -a /from/. /to/'
   ```
3. Edit `project_id` in [supabase/config.toml](../supabase/config.toml)
   and `name:` / `container_name:` in [docker-compose.yml](../docker-compose.yml).
4. `pnpm start:services` — the new stack picks up the cloned volumes.
5. Verify (`psql` row counts, `redis-cli DBSIZE`), then drop the
   originals with `docker volume rm <old-name>`.

> Compose v2 always lowercases project names. If you pick a name with
> uppercase letters it'll silently become lowercase, which breaks
> volume references. Use lowercase-kebab.

---

## 9. Troubleshooting

### `pnpm test:start:dev` exits with `ECONNREFUSED ::1:6380`

Redis isn't running. Start it:
```bash
pnpm start:services
```

### `Can't reach database server at 127.0.0.1:54332`

Supabase isn't running. Run `pnpm start:services` (or just `supabase start`).

### `pnpm start:services` hangs on Supabase health checks

Stale containers from a crashed run. Reset with:
```bash
supabase stop --no-backup
pnpm start:services
```

### Port already in use on start

Another project (e.g. UrbanFlow) is binding a default port. Check with
`lsof -i :<port>`.

### Studio shows empty schema after a rename

The Postgres volume was recreated under a new name without migration.
See [§8](#8-renaming-the-stack) for the safe rename procedure.

### Old volumes hidden in Docker Desktop UI

Volumes labeled with a project that has no containers — Docker
Desktop's Volumes tab groups by project and effectively hides
projectless volumes. List them via CLI: `docker volume ls | grep incacook`.

### Auth emails not arriving

Mailpit is the local sink for everything outgoing. Open
http://127.0.0.1:54334 — no email actually leaves the machine.

### `Idempotency-Key header is required` on `POST /v1/orders`

Add a header — any string is fine for testing:
```
-H "Idempotency-Key: $(uuidgen)"
```

### Stripe API calls fail with `Invalid API Key`

`.env.test` ships with placeholder Stripe keys (`sk_test_xxx`).
Replace with real test-mode keys from your Stripe dashboard for any
payment-related flow. The Stripe webhook secret comes from running:
```bash
stripe listen --forward-to http://localhost:3001/v1/stripe/webhook
```
which prints a `whsec_...` you paste into `.env.test`.

### `Stripe API calls fail with "No such destination" on transfers`

Seeded sellers/drivers have fake Connect IDs (`acct_test_seed_seller`).
For real transfer testing, create real test-mode Connect accounts via
the Stripe dashboard and update the seed (or those users) with the
actual IDs.

### Migration failed with a stuck "applied: false" row

Roll back the failed migration record so it can be retried:
```bash
dotenv -e .env.test -- prisma migrate resolve --rolled-back <migration_name>
```

### Storage uploads return 404

The buckets don't exist in this local stack. Re-run the bucket-creation
SQL in [§4.5](#45-create-the-four-storage-buckets).

---

## 10. pnpm scripts cheat sheet

| Script | What it does |
|---|---|
| `pnpm start:services` | `docker compose up -d && npx supabase start` — boots both stacks |
| `pnpm stop:services` | `docker compose down && npx supabase stop` — stops both stacks (volumes preserved) |
| `pnpm test:start:dev` | Start the API with `.env.test` in watch mode |
| `pnpm test:db:migrate` | Apply all migrations to local DB |
| `pnpm test:db:reset` | Drop + recreate public schema; reapply migrations |
| `pnpm test:db:seed` | Seed the 4 test users + 3 listings |
| `pnpm test:mint-jwt <role>` | Mint a local-test JWT (admin/buyer/seller/driver) |
| `pnpm prisma:studio` | Prisma Studio against the env Prisma loads (`.env`) |
| `pnpm prisma:seed` | Seed against `.env` (remote dev) — different from `test:db:seed`! |

---

## 11. `.env.test` template

If you're recreating `.env.test` from scratch, this is the working template:

```bash
NODE_ENV=test
PORT=3001
APP_URL=http://localhost:3001
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:8081

# Local Supabase Postgres (no pooler locally — both URLs hit the direct port)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54332/postgres
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54332/postgres

# Local Supabase (defaults from the CLI — public)
SUPABASE_URL=http://127.0.0.1:54331
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long

SUPABASE_STORAGE_BUCKET_LISTINGS=listings
SUPABASE_STORAGE_BUCKET_KYC=kyc
SUPABASE_STORAGE_BUCKET_AVATARS=avatars

REDIS_URL=redis://localhost:6380
REDIS_HOST=localhost
REDIS_PORT=6380

# Replace with your real test-mode Stripe keys when ready to test payments
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_CONNECT_CLIENT_ID=ca_xxx
STRIPE_ONBOARDING_RETURN_URL=http://localhost:3001/stub/stripe/return
STRIPE_ONBOARDING_REFRESH_URL=http://localhost:3001/stub/stripe/refresh

JWT_SECRET=local-test-jwt-secret-not-for-production-use-32+chars
JWT_EXPIRATION=7d

RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=1000

COMMISSION_PERCENTAGE_STANDARD=30
COMMISSION_PERCENTAGE_PREMIUM=25
COMMISSION_MINIMUM_EUROS=1
DELIVERY_FEE_EUROS=2.50
WITHDRAWAL_MINIMUM_EUROS=50
LE_BON_FAIT_MAISON_PRICE_CAP=4.50
```

---

## 12. Related docs

- [architecture.md](./architecture.md) — application architecture
- [deployment.md](./deployment.md) — remote / production setup
- [flutter-integration.md](./flutter-integration.md) — mobile client integration
