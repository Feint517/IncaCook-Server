-- =============================================================================
-- Signup flow Phase A — split atomic seller/driver profile rows into a stub
-- created at Gate 2 + role-specific child rows filled in via per-concept
-- PUT endpoints (Phase B). See docs/signup-flow.md for the design.
--
-- This migration is intentionally one-shot: schema changes + data backfill
-- in the same transaction. If any backfill step fails, the whole migration
-- rolls back — easier to reason about than two-step.
-- =============================================================================

-- -------- 1. New enums --------

CREATE TYPE "AddressKind" AS ENUM ('BUYER_DELIVERY', 'SELLER_PICKUP', 'DRIVER_HOME');
CREATE TYPE "KycDocType" AS ENUM ('ID_FRONT', 'ID_BACK', 'SELFIE', 'DRIVING_LICENSE', 'CARTE_GRISE', 'INSURANCE');
CREATE TYPE "CharterKind" AS ENUM ('CGU', 'CGV', 'HYGIENE', 'FAIT_MAISON', 'PUNCTUALITY', 'CARE');

-- -------- 2. New tables --------

CREATE TABLE "SellerBusiness" (
    "userId"       TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "siret"        TEXT NOT NULL,
    "facadeUrl"    TEXT,
    "legalForm"    TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellerBusiness_pkey" PRIMARY KEY ("userId")
);
CREATE UNIQUE INDEX "SellerBusiness_siret_key" ON "SellerBusiness"("siret");

CREATE TABLE "SellerCuisine" (
    "userId"      TEXT NOT NULL,
    "cuisineType" "CuisineType" NOT NULL,
    CONSTRAINT "SellerCuisine_pkey" PRIMARY KEY ("userId", "cuisineType")
);
CREATE INDEX "SellerCuisine_cuisineType_idx" ON "SellerCuisine"("cuisineType");

CREATE TABLE "SellerDish" (
    "userId"   TEXT NOT NULL,
    "dishType" "DishType" NOT NULL,
    CONSTRAINT "SellerDish_pkey" PRIMARY KEY ("userId", "dishType")
);
CREATE INDEX "SellerDish_dishType_idx" ON "SellerDish"("dishType");

CREATE TABLE "DriverZone" (
    "userId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    CONSTRAINT "DriverZone_pkey" PRIMARY KEY ("userId", "zoneId")
);
CREATE INDEX "DriverZone_zoneId_idx" ON "DriverZone"("zoneId");

CREATE TABLE "UserCharter" (
    "userId"     TEXT NOT NULL,
    "charter"    "CharterKind" NOT NULL,
    "version"    TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserCharter_pkey" PRIMARY KEY ("userId", "charter", "version")
);
CREATE INDEX "UserCharter_userId_charter_acceptedAt_idx"
  ON "UserCharter"("userId", "charter", "acceptedAt" DESC);

CREATE TABLE "KycDocument" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "type"            "KycDocType" NOT NULL,
    "fileUrl"         TEXT NOT NULL,
    "reviewState"     "KycStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId"      TEXT,
    "reviewedAt"      TIMESTAMP(3),
    "rejectionReason" TEXT,
    "metadata"        JSONB,
    "submittedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KycDocument_userId_type_key" ON "KycDocument"("userId", "type");
CREATE INDEX "KycDocument_reviewState_submittedAt_idx"
  ON "KycDocument"("reviewState", "submittedAt");
CREATE INDEX "KycDocument_userId_idx" ON "KycDocument"("userId");

-- -------- 3. Address.kind — new column + backfill --------

-- Nullable for the backfill window; tightened to NOT NULL after the UPDATE
-- statements below.
ALTER TABLE "Address" ADD COLUMN "kind" "AddressKind";

UPDATE "Address" a SET "kind" = 'BUYER_DELIVERY'
  FROM "BuyerProfile" bp WHERE bp."defaultAddressId" = a."id";
UPDATE "Address" a SET "kind" = 'SELLER_PICKUP'
  FROM "SellerProfile" sp WHERE sp."pickupAddressId" = a."id";
UPDATE "Address" a SET "kind" = 'DRIVER_HOME'
  FROM "DriverProfile" dp WHERE dp."baseAddressId" = a."id";

-- Any addresses not linked from a profile (e.g. order dropoffs) default to
-- BUYER_DELIVERY since that's the buyer-saved-address surface.
UPDATE "Address" SET "kind" = 'BUYER_DELIVERY' WHERE "kind" IS NULL;

ALTER TABLE "Address" ALTER COLUMN "kind" SET NOT NULL;

CREATE INDEX "Address_userId_kind_idx" ON "Address"("userId", "kind");

-- Partial unique idx: seller has at most one SELLER_PICKUP, driver at most
-- one DRIVER_HOME. Buyer can have multiple BUYER_DELIVERY rows (HOME / WORK /
-- OTHER via Address.type), so they're not constrained here.
CREATE UNIQUE INDEX "Address_userId_kind_unique_singleton"
  ON "Address"("userId", "kind")
  WHERE "kind" IN ('SELLER_PICKUP', 'DRIVER_HOME');

-- -------- 4. Backfill SellerBusiness from SellerProfile --------

INSERT INTO "SellerBusiness" ("userId", "businessName", "siret", "facadeUrl", "createdAt", "updatedAt")
  SELECT "userId", "businessName", "siret", "restaurantFacadeUrl",
         "createdAt", "updatedAt"
  FROM "SellerProfile"
  WHERE "businessName" IS NOT NULL AND "siret" IS NOT NULL;

-- -------- 5. Backfill SellerCuisine / SellerDish from arrays --------

INSERT INTO "SellerCuisine" ("userId", "cuisineType")
  SELECT "userId", unnest("cuisineTypes") FROM "SellerProfile"
  WHERE array_length("cuisineTypes", 1) IS NOT NULL
  ON CONFLICT DO NOTHING;

INSERT INTO "SellerDish" ("userId", "dishType")
  SELECT "userId", unnest("dishTypes") FROM "SellerProfile"
  WHERE array_length("dishTypes", 1) IS NOT NULL
  ON CONFLICT DO NOTHING;

-- -------- 6. Backfill DriverZone from operatingZones[] --------

INSERT INTO "DriverZone" ("userId", "zoneId")
  SELECT "userId", unnest("operatingZones") FROM "DriverProfile"
  WHERE array_length("operatingZones", 1) IS NOT NULL
  ON CONFLICT DO NOTHING;

-- -------- 7. Backfill KycDocument from KycSubmission --------

-- One row per non-null URL on the latest submission per user. Older
-- submissions are discarded (Phase A intentionally simplifies — KycDocument
-- represents the current effective state, not the history).
WITH latest AS (
  SELECT DISTINCT ON ("userId") *
  FROM "KycSubmission"
  ORDER BY "userId", "submittedAt" DESC
)
INSERT INTO "KycDocument" ("id", "userId", "type", "fileUrl", "reviewState",
                          "reviewerId", "reviewedAt", "rejectionReason",
                          "metadata", "submittedAt")
SELECT gen_random_uuid()::text, "userId", t.kind::"KycDocType", t.url,
       "status", "reviewerId", "reviewedAt", "rejectionReason",
       CASE WHEN t.kind IN ('ID_FRONT', 'ID_BACK')
            THEN jsonb_build_object('idDocumentType', "idDocumentType")
            ELSE NULL END,
       "submittedAt"
FROM latest
CROSS JOIN LATERAL (
  VALUES
    ('ID_FRONT',        "idFrontUrl"),
    ('ID_BACK',         "idBackUrl"),
    ('SELFIE',          "selfieUrl"),
    ('DRIVING_LICENSE', "drivingLicenseUrl"),
    ('CARTE_GRISE',     "carteGriseUrl"),
    ('INSURANCE',       "insuranceUrl")
) AS t(kind, url)
WHERE t.url IS NOT NULL;

-- -------- 8. Rekey SellerOpeningHours to SellerBusiness --------

-- Drop opening hours for sellers without a business row (fait-maison only).
DELETE FROM "SellerOpeningHours"
  WHERE "sellerId" NOT IN (SELECT "userId" FROM "SellerBusiness");

ALTER TABLE "SellerOpeningHours"
  DROP CONSTRAINT IF EXISTS "SellerOpeningHours_sellerId_fkey";
ALTER TABLE "SellerOpeningHours"
  ADD CONSTRAINT "SellerOpeningHours_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "SellerBusiness"("userId") ON DELETE CASCADE;

-- -------- 9. Foreign keys on new tables --------

ALTER TABLE "SellerBusiness" ADD CONSTRAINT "SellerBusiness_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "SellerProfile"("userId") ON DELETE CASCADE;

ALTER TABLE "SellerCuisine" ADD CONSTRAINT "SellerCuisine_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "SellerProfile"("userId") ON DELETE CASCADE;

ALTER TABLE "SellerDish" ADD CONSTRAINT "SellerDish_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "SellerProfile"("userId") ON DELETE CASCADE;

ALTER TABLE "DriverZone" ADD CONSTRAINT "DriverZone_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "DriverProfile"("userId") ON DELETE CASCADE;

ALTER TABLE "UserCharter" ADD CONSTRAINT "UserCharter_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL;

-- -------- 10. Drop now-redundant columns / tables --------

-- Drop FKs first (Prisma named them on the *Profile side).
ALTER TABLE "BuyerProfile"  DROP CONSTRAINT IF EXISTS "BuyerProfile_defaultAddressId_fkey";
ALTER TABLE "SellerProfile" DROP CONSTRAINT IF EXISTS "SellerProfile_pickupAddressId_fkey";
ALTER TABLE "DriverProfile" DROP CONSTRAINT IF EXISTS "DriverProfile_baseAddressId_fkey";

DROP INDEX IF EXISTS "SellerProfile_pickupAddressId_key";
DROP INDEX IF EXISTS "DriverProfile_baseAddressId_key";

ALTER TABLE "BuyerProfile"  DROP COLUMN "defaultAddressId";
ALTER TABLE "SellerProfile" DROP COLUMN "pickupAddressId",
                            DROP COLUMN "businessName",
                            DROP COLUMN "siret",
                            DROP COLUMN "restaurantFacadeUrl",
                            DROP COLUMN "cuisineTypes",
                            DROP COLUMN "dishTypes";
ALTER TABLE "DriverProfile" DROP COLUMN "baseAddressId",
                            DROP COLUMN "operatingZones";

-- -------- 11. SellerProfile / DriverProfile field nullability --------

-- Make signup fields nullable so a stub row can exist at Gate 2.
ALTER TABLE "SellerProfile"
  ALTER COLUMN "category"             DROP NOT NULL,
  ALTER COLUMN "displayName"          DROP NOT NULL,
  ALTER COLUMN "profilePhotoUrl"      DROP NOT NULL,
  ALTER COLUMN "dateOfBirth"          DROP NOT NULL,
  ALTER COLUMN "hygieneCommitment"    DROP NOT NULL,
  ALTER COLUMN "hygieneCommitment"    DROP DEFAULT,
  ALTER COLUMN "faitMaisonCommitment" DROP NOT NULL,
  ALTER COLUMN "faitMaisonCommitment" DROP DEFAULT,
  ALTER COLUMN "deliveryRadiusKm"     DROP NOT NULL,
  ALTER COLUMN "deliveryFeeCents"     DROP NOT NULL,
  ALTER COLUMN "prepMinMinutes"       DROP NOT NULL,
  ALTER COLUMN "prepMaxMinutes"       DROP NOT NULL,
  ALTER COLUMN "neighborhood"         DROP NOT NULL;

ALTER TABLE "DriverProfile"
  ALTER COLUMN "dateOfBirth"           DROP NOT NULL,
  ALTER COLUMN "vehicleType"           DROP NOT NULL,
  ALTER COLUMN "charterAccepted"       DROP NOT NULL,
  ALTER COLUMN "charterAccepted"       DROP DEFAULT,
  ALTER COLUMN "punctualityCommitment" DROP NOT NULL,
  ALTER COLUMN "punctualityCommitment" DROP DEFAULT,
  ALTER COLUMN "careCommitment"        DROP NOT NULL,
  ALTER COLUMN "careCommitment"        DROP DEFAULT;

-- -------- 12. Drop KycSubmission --------

DROP TABLE "KycSubmission";
