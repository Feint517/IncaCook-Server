-- Slice C: driver / delivery flow + Stripe transfer payout.
--   * IssueSeverity enum + OrderIssue table (driver-reported issues mid-job)
--   * Order: stripeTransferId / stripeDriverTransferId / transferredAt
--     for tracking the payouts triggered on confirm-delivery.

-- ============================================================
-- 1. IssueSeverity enum
-- ============================================================

CREATE TYPE "IssueSeverity" AS ENUM ('ABORT', 'REPORT');

-- ============================================================
-- 2. Order: payout-tracking columns (separate-charges → manual transfers)
-- ============================================================

ALTER TABLE "Order"
    ADD COLUMN "stripeTransferId"       TEXT,
    ADD COLUMN "stripeDriverTransferId" TEXT,
    ADD COLUMN "transferredAt"          TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_stripeTransferId_key"
    ON "Order"("stripeTransferId");

CREATE UNIQUE INDEX "Order_stripeDriverTransferId_key"
    ON "Order"("stripeDriverTransferId");

-- ============================================================
-- 3. OrderIssue
-- ============================================================

CREATE TABLE "OrderIssue" (
    "id"                TEXT NOT NULL,
    "deliveryId"        TEXT NOT NULL,
    "driverId"          TEXT NOT NULL,
    "issueCode"         TEXT NOT NULL,
    "severity"          "IssueSeverity" NOT NULL,
    "stageWhenReported" "OrderStatus" NOT NULL,
    "freeText"          TEXT,
    "reportedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderIssue_deliveryId_idx" ON "OrderIssue"("deliveryId");
CREATE INDEX "OrderIssue_driverId_reportedAt_idx"
    ON "OrderIssue"("driverId", "reportedAt" DESC);
CREATE INDEX "OrderIssue_severity_idx" ON "OrderIssue"("severity");

ALTER TABLE "OrderIssue"
    ADD CONSTRAINT "OrderIssue_deliveryId_fkey"
    FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderIssue"
    ADD CONSTRAINT "OrderIssue_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;
