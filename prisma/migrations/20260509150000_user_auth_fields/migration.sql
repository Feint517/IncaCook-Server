-- Replace `displayName` with separate first/last name columns, add legal
-- terms acceptance and Supabase auth verification mirrors. Required by the
-- login + signup flow.
--
-- Safe to apply to an empty dev DB. If the User table already has rows,
-- backfill `firstName`/`lastName` from `displayName` before running this.

ALTER TABLE "User" DROP COLUMN "displayName",
    ADD COLUMN "firstName" TEXT NOT NULL,
    ADD COLUMN "lastName" TEXT NOT NULL,
    ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "acceptedCgu" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "acceptedCgv" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "acceptedAt" TIMESTAMP(3);
