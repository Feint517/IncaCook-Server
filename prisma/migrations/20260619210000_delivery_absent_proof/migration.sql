-- Client-absent delivery proof fields on Delivery. Idempotent.
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredAsAbsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofPhotoUrl" TEXT;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofLat" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofLng" DOUBLE PRECISION;
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofTakenAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofContactAttemptedAt" TIMESTAMP(3);
ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofNote" TEXT;
