-- Buyer→driver delivery (dropoff) proof fields on Delivery. Idempotent.
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveryToken" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredConfirmedByDriverId" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredLat" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredLng" DOUBLE PRECISION;
CREATE UNIQUE INDEX IF NOT EXISTS "Delivery_deliveryToken_key" ON "Delivery"("deliveryToken");
