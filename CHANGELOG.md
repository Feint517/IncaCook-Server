# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-08

### Added
- Foundation scaffold: NestJS 11 + Node 22 + pnpm + Prisma 6.
- Strict TypeScript config with path aliases (`@/`, `@common/`, `@config/`, `@infrastructure/`, `@modules/`, `@jobs/`).
- Validated environment via Zod (`src/config/env.validation.ts`).
- Global pipeline: helmet, compression, CORS, validation pipe, exception filter, transform/logging/timeout interceptors, correlation IDs, ULID generator.
- Global throttling backed by Redis + BullMQ queue infrastructure.
- Auth scaffolding: Passport JWT strategy validating Supabase JWTs.
- Infrastructure modules wired but inert: Redis, BullMQ, Supabase (anon + admin), Storage (signed URLs), Stripe, FCM, Twilio, Resend, Mapbox, Pino logger, audit logger.
- Empty domain module placeholders for every feature in the product roadmap.
- Health module with liveness + readiness endpoints.
- Docker multi-stage build, docker-compose with Redis + Mailhog, GitHub Actions CI + deploy stub.
- Husky + lint-staged pre-commit hook.
- Documentation seeds in `docs/` (architecture, API conventions, auth flow, error codes, deployment).
