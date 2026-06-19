-- Strikes/exclusion system: account suspension flags + Strike table. Idempotent.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT;

CREATE TABLE IF NOT EXISTS "Strike" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorRole" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "orderId" TEXT,
  "deliveryId" TEXT,
  "notes" TEXT,
  "createdBy" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "Strike_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Strike_userId_actorRole_createdAt_idx" ON "Strike"("userId", "actorRole", "createdAt");
CREATE INDEX IF NOT EXISTS "Strike_userId_actorRole_reason_idx" ON "Strike"("userId", "actorRole", "reason");
DO $$ BEGIN
  ALTER TABLE "Strike" ADD CONSTRAINT "Strike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
