# Local testing setup

End-to-end guide for running the IncaCook server against a fully local
Supabase stack. Use this for manual smoke testing, integration testing, or
just experimenting without touching the remote dev Supabase project.

> The local stack uses well-known default credentials (anon key, service
> role key, JWT secret) that ship with the Supabase CLI. They are public
> knowledge — never reuse them in production.

> **Ports are remapped from Supabase defaults.** IncaCook coexists on
> this machine with the UrbanFlow project, which already binds the
> defaults (54321-54324, 6379). To avoid clashes, IncaCook uses
> **54331-54334** for Supabase and **6380** for Redis. Container names
> are also suffixed `_IncaCook` (Supabase) / `IncaCook-redis` (Redis).
>
> | Service | IncaCook | Default |
> |---|---|---|
> | API / Kong | 54331 | 54321 |
> | Postgres (DB) | 54332 | 54322 |
> | Studio | 54333 | 54323 |
> | Mailpit (Inbucket) | 54334 | 54324 |
> | Analytics | 54337 | 54327 |
> | Redis | 6380 | 6379 |
> | Nest API (this server) | 3001 | 3000 |
>
> If you ever run a one-off `psql` / `curl` against the local stack,
> use the IncaCook ports above. `.env.test` is already wired to these.

---

## 1. Prerequisites

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

## 2. First-time setup

Run these once after cloning the repo (or after a fresh machine).

### 2.1 Install Node dependencies

```bash
pnpm install
```

### 2.2 Start the local Supabase stack

The `supabase/` config is already committed to the repo (created via
`supabase init`). First boot downloads ~3 GB of Docker images and takes
several minutes.

```bash
supabase start
```

When done, `supabase status -o env` prints the credentials. The local
defaults already live in `.env.test` — you don't normally need to look at
the printout again unless something changes.

### 2.3 Start a Redis container

The API uses Redis for cache + queues. The repo ships a `docker-compose.yml`
that defines the `IncaCook-redis` container (with a persistent volume):

```bash
docker compose up -d redis
```

This survives reboots — subsequent sessions only need `docker compose
up -d redis` (it's idempotent).

### 2.4 Create `.env.test`

The file is gitignored. If you don't have one yet, copy a fresh template:

```bash
cp .env.test.example .env.test   # if the example exists
# OR copy the example block at the bottom of this doc
```

`.env.test` already points at the local Supabase stack. The Stripe-related
values are placeholders; fill them with real **test-mode** Stripe keys
when you want to exercise payment flows.

### 2.5 Apply all migrations to the local DB

```bash
pnpm test:db:migrate
```

This applies every migration in `prisma/migrations/` to the local Postgres
on port `54332`.

### 2.6 Create the four Storage buckets

The local Supabase ships without buckets. The app references `avatars`,
`listings`, `kyc`, and `seller-facades`. Create them once:

```bash
docker exec supabase_db_IncaCook psql -U postgres -d postgres -c "
INSERT INTO storage.buckets (id, name, public) VALUES
  ('avatars',         'avatars',         true),
  ('listings',        'listings',        true),
  ('kyc',             'kyc',             false),
  ('seller-facades',  'seller-facades',  true)
ON CONFLICT (id) DO NOTHING;"
```

Storage RLS policies for these buckets came in via migrations and are
already attached.

### 2.7 Seed test data

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

The seed is idempotent — re-running wipes and recreates these four users
(and their related rows) without touching anything else.

---

## 3. Daily workflow

### 3.1 Bring everything up

```bash
# Once per machine reboot
docker compose up -d redis                 # IncaCook-redis (idempotent)
supabase start                             # idempotent — no-ops if already running

# Boot the API
pnpm test:start:dev
```

The server is now listening on http://localhost:3001 with `.env.test`
loaded.

### 3.2 Mint test JWTs

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

### 3.2a Verify the phone gate via email OTP (temporary bypass)

While the SMS provider is unavailable, `POST /v1/auth/email/request-otp`
+ `POST /v1/auth/email/verify` flip `User.phoneVerified` using an email
code instead of an SMS code. See [signup-flow.md §3.9](signup-flow.md#39-post-v1authphoneverify--bearer)
for the API.

Locally:

```bash
TOKEN=$(pnpm -s test:mint-jwt seller)
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/v1/auth/email/request-otp
# → 204; the 6-digit code lands in Mailpit (see §3.3) for the test
#   account's email. Copy it, then:
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}' \
  http://localhost:3001/v1/auth/email/verify
```

The Mailpit inbox at http://127.0.0.1:54334 catches all Supabase auth
emails — no real send. Codes expire after a few minutes.

### 3.3 Browse the local Postgres / Storage

- **Supabase Studio**: http://127.0.0.1:54333 — DB browser, storage UI
- **Mailpit**: http://127.0.0.1:54334 — local email inbox
- **Prisma Studio**: `pnpm prisma:studio` (against whichever env's
  `DATABASE_URL` is set; for test env prefix with `dotenv -e .env.test --`)

### 3.4 Reset state between tests

Two flavours:

```bash
# Fast — drops + recreates the public schema only
pnpm test:db:reset                         # `prisma migrate reset --force`

# Heavier — also resets storage, auth tables, etc.
supabase db reset                          # rebuilds the whole Supabase DB
pnpm test:db:migrate
# Re-create buckets (see §2.6)
pnpm test:db:seed
```

For most testing iterations `pnpm test:db:reset && pnpm test:db:seed` is
all you need.

---

## 4. Stopping the local environment

### 4.1 Stop the API server

```bash
# In the terminal running `pnpm test:start:dev`, press Ctrl+C.
# If it's in the background:
pkill -f "nest start --watch"
```

### 4.2 Stop Supabase

```bash
supabase stop
```

This **stops the containers but preserves the DB volume**. Next `supabase
start` resumes with all your seeded data intact.

To wipe the local DB volume entirely (lose all data, fresh next boot):

```bash
supabase stop --no-backup
```

### 4.3 Stop Redis

```bash
docker compose stop redis
```

This stops the container but keeps it around (and the data volume).
Restart with `docker compose up -d redis`. To remove the container and
the data volume entirely:

```bash
docker compose down -v
```

### 4.4 Full teardown (rare — only when freeing disk space)

```bash
pkill -f "nest start --watch"      # API
supabase stop --no-backup           # Supabase + DB volume
docker compose down -v              # IncaCook-redis + its data volume
# To also remove the Supabase Docker images (~3 GB) — note: shared with
# other Supabase projects on this machine, removing affects them too:
docker images | grep supabase | awk '{print $3}' | xargs docker rmi
```

---

## 5. Troubleshooting

### `pnpm test:start:dev` exits with `ECONNREFUSED ::1:6380`

Redis isn't running. Start it:
```bash
docker compose up -d redis
```

### `Can't reach database server at 127.0.0.1:54332`

Supabase isn't running. `supabase start`.

### `Idempotency-Key header is required` on `POST /v1/orders`

Add a header — any string is fine for testing:
```
-H "Idempotency-Key: $(uuidgen)"
```

### Stripe API calls fail with `Invalid API Key`

`.env.test` ships with placeholder Stripe keys (`sk_test_xxx`). Replace
with real test-mode keys from your Stripe dashboard for any payment-related
flow. The Stripe webhook secret comes from running:
```bash
stripe listen --forward-to http://localhost:3001/v1/stripe/webhook
```
which prints a `whsec_...` you paste into `.env.test`.

### `Stripe API calls fail with "No such destination" on transfers`

Seeded sellers/drivers have fake Connect IDs (`acct_test_seed_seller`).
For real transfer testing, create real test-mode Connect accounts via the
Stripe dashboard and update the seed (or those users) with the actual IDs.

### Migration failed with a stuck "applied: false" row

Roll back the failed migration record so it can be retried:
```bash
dotenv -e .env.test -- prisma migrate resolve --rolled-back <migration_name>
```

### Storage uploads return 404

The buckets don't exist in this local stack. Re-run the bucket-creation
SQL in §2.6.

---

## 6. Quick reference: pnpm scripts

| Script | What it does |
|---|---|
| `pnpm test:start:dev` | Start the API with `.env.test` |
| `pnpm test:db:migrate` | Apply all migrations to local DB |
| `pnpm test:db:reset` | Drop + recreate public schema; reapply migrations |
| `pnpm test:db:seed` | Seed the 4 test users + 3 listings |
| `pnpm test:mint-jwt <role>` | Mint a local-test JWT (admin/buyer/seller/driver) |
| `pnpm prisma:studio` | Prisma Studio against the env Prisma loads (`.env`) |
| `pnpm prisma:seed` | Seed against `.env` (remote dev) — different from `test:db:seed`! |

---

## 7. `.env.test` template

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
