-- Records when a PENDING wallet entry was released to AVAILABLE. Idempotent.
ALTER TABLE "WalletEntry" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);
