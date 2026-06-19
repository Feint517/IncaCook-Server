-- Seller-unavailable-at-pickup report fields on Delivery. Idempotent.
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableReason" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableLat" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableLng" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableNote" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailablePhotoUrl" TEXT;
