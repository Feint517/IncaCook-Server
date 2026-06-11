-- Internal wallet ledger. Sellers/drivers are credited on order completion;
-- real Stripe payouts happen only on withdrawal. Idempotent / additive.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletEntryType') THEN
    CREATE TYPE "WalletEntryType" AS ENUM (
      'ORDER_EARNING','DELIVERY_EARNING','COMMISSION','REFUND','WITHDRAWAL'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletEntryStatus') THEN
    CREATE TYPE "WalletEntryStatus" AS ENUM (
      'PENDING','AVAILABLE','HELD','PAID_OUT','CANCELLED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WalletEntry" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "orderId"      TEXT,
  "type"         "WalletEntryType" NOT NULL,
  "amountCents"  INTEGER NOT NULL,
  "currency"     TEXT NOT NULL DEFAULT 'eur',
  "status"       "WalletEntryStatus" NOT NULL DEFAULT 'AVAILABLE',
  "withdrawalId" TEXT,
  "availableAt"  TIMESTAMP(3),
  "metadata"     JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletEntry_pkey" PRIMARY KEY ("id")
);

-- Idempotency: one earning/commission row per (order, user, type).
CREATE UNIQUE INDEX IF NOT EXISTS "WalletEntry_orderId_userId_type_key"
  ON "WalletEntry"("orderId","userId","type");
CREATE INDEX IF NOT EXISTS "WalletEntry_userId_status_idx"
  ON "WalletEntry"("userId","status");
CREATE INDEX IF NOT EXISTS "WalletEntry_orderId_idx"
  ON "WalletEntry"("orderId");
