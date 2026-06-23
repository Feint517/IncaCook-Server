-- Catalog SAV (after-sales) claims + refund tracking on catalog orders.
ALTER TYPE "CatalogOrderStatus" ADD VALUE IF NOT EXISTS 'REFUNDED';
ALTER TABLE "CatalogOrder" ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT;

CREATE TABLE IF NOT EXISTS "CatalogClaim" (
  "id"                TEXT NOT NULL,
  "catalogOrderId"    TEXT NOT NULL,
  "sellerId"          TEXT NOT NULL,
  "type"              TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'OPEN',
  "description"       TEXT NOT NULL,
  "photoUrls"         JSONB,
  "adminNotes"        TEXT,
  "refundAmountCents" INTEGER,
  "replacementNotes"  TEXT,
  "stripeRefundId"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "resolvedAt"        TIMESTAMP(3),
  CONSTRAINT "CatalogClaim_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CatalogClaim_catalogOrderId_idx" ON "CatalogClaim"("catalogOrderId");
CREATE INDEX IF NOT EXISTS "CatalogClaim_sellerId_idx" ON "CatalogClaim"("sellerId");
CREATE INDEX IF NOT EXISTS "CatalogClaim_status_idx" ON "CatalogClaim"("status");
