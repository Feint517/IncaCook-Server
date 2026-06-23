-- Stripe chargeback link + payload on OrderDispute. Idempotent.
ALTER TABLE "OrderDispute" ADD COLUMN IF NOT EXISTS "stripeDisputeId" TEXT;
ALTER TABLE "OrderDispute" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "OrderDispute_stripeDisputeId_key" ON "OrderDispute"("stripeDisputeId");
