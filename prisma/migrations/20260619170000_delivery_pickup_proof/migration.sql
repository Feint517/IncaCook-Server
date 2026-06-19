-- Seller→driver pickup proof fields on Delivery. Idempotent (IF NOT EXISTS).
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupToken" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupConfirmedByDriverId" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupLat" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupLng" DOUBLE PRECISION;
CREATE UNIQUE INDEX IF NOT EXISTS "Delivery_pickupToken_key" ON "Delivery"("pickupToken");
