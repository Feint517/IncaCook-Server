-- Seller signup, phase 1: profile + opening hours.
--
-- Touches multiple tables:
--   * SellerProfile: drop id PK, make userId the PK; drop pickupAddress/
--     pickupPoint/kitchenNotes/slug; add ~20 signup-time columns; add
--     denormalized location; INSERT trigger for category-based KYC default.
--   * DriverProfile: drop id PK, make userId the PK.
--   * Listing: re-target sellerId FK to SellerProfile.userId; replace
--     courseType/cuisines with dishType/cuisineType; rename dietary →
--     dietaryTags; rename Dietary enum → DietaryTag.
--   * Order: re-target sellerId FK to SellerProfile.userId.
--   * Delivery: re-target driverId FK to DriverProfile.userId.
--   * KycStatus: drop SUBMITTED.
--   * New enums: CuisineType, DishType, DayOfWeek.
--   * Drop CourseType.
--   * New table: SellerOpeningHours.
--
-- Safe to apply only when SellerProfile, DriverProfile, Listing, Order,
-- and Delivery are empty (FK retargeting + enum rebuilds would otherwise
-- fail mid-migration).

-- ============================================================
-- 1. New enums
-- ============================================================

CREATE TYPE "CuisineType" AS ENUM (
    'ORIENTALE', 'FRANCAISE', 'AFRICAINE', 'PORTUGAISE',
    'ITALIENNE', 'ESPAGNOLE', 'LATINE'
);

CREATE TYPE "DishType" AS ENUM ('ENTREE', 'PLAT', 'DESSERT', 'COCKTAIL_DINATOIRE');

CREATE TYPE "DayOfWeek" AS ENUM (
    'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY',
    'FRIDAY', 'SATURDAY', 'SUNDAY'
);

-- ============================================================
-- 2. Rename Dietary enum → DietaryTag
-- ============================================================

ALTER TYPE "Dietary" RENAME TO "DietaryTag";

-- ============================================================
-- 3. Rebuild KycStatus (drop SUBMITTED)
-- ============================================================

ALTER TABLE "SellerProfile" ALTER COLUMN "kycStatus" DROP DEFAULT;
ALTER TABLE "DriverProfile" ALTER COLUMN "kycStatus" DROP DEFAULT;
ALTER TABLE "SellerProfile" ALTER COLUMN "kycStatus" TYPE TEXT;
ALTER TABLE "DriverProfile" ALTER COLUMN "kycStatus" TYPE TEXT;
DROP TYPE "KycStatus";
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "SellerProfile" ALTER COLUMN "kycStatus" TYPE "KycStatus" USING "kycStatus"::"KycStatus";
ALTER TABLE "DriverProfile" ALTER COLUMN "kycStatus" TYPE "KycStatus" USING "kycStatus"::"KycStatus";
ALTER TABLE "SellerProfile" ALTER COLUMN "kycStatus" SET DEFAULT 'PENDING';
ALTER TABLE "DriverProfile" ALTER COLUMN "kycStatus" SET DEFAULT 'PENDING';

-- ============================================================
-- 4. Listing: drop courseType + cuisines, add dishType + cuisineType,
--    rename dietary → dietaryTags. Drop FK so we can retarget it.
-- ============================================================

ALTER TABLE "Listing" DROP CONSTRAINT "Listing_sellerId_fkey";
ALTER TABLE "Listing" DROP COLUMN "courseType";
ALTER TABLE "Listing" DROP COLUMN "cuisines";
ALTER TABLE "Listing" ADD COLUMN "cuisineType" "CuisineType";
ALTER TABLE "Listing" ADD COLUMN "dishType" "DishType";
ALTER TABLE "Listing" RENAME COLUMN "dietary" TO "dietaryTags";

-- ============================================================
-- 5. Drop CourseType (no longer referenced)
-- ============================================================

DROP TYPE "CourseType";

-- ============================================================
-- 6. Order: drop FK so we can retarget it after SellerProfile PK swap
-- ============================================================

ALTER TABLE "Order" DROP CONSTRAINT "Order_sellerId_fkey";

-- ============================================================
-- 7. Delivery: drop FK so we can retarget after DriverProfile PK swap
-- ============================================================

ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_driverId_fkey";

-- ============================================================
-- 8. SellerProfile: restructure
--    - drop id (PK), drop unique on userId, make userId the PK
--    - drop deprecated columns
--    - add signup-time columns
-- ============================================================

ALTER TABLE "SellerProfile" DROP CONSTRAINT "SellerProfile_pkey";
ALTER TABLE "SellerProfile" DROP COLUMN "id";
DROP INDEX "SellerProfile_userId_key";
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_pkey" PRIMARY KEY ("userId");

ALTER TABLE "SellerProfile" DROP COLUMN "pickupAddress";
ALTER TABLE "SellerProfile" DROP COLUMN "pickupPoint";
ALTER TABLE "SellerProfile" DROP COLUMN "kitchenNotes";
DROP INDEX IF EXISTS "SellerProfile_slug_key";
ALTER TABLE "SellerProfile" DROP COLUMN "slug";

ALTER TABLE "SellerProfile"
    ADD COLUMN "profilePhotoUrl"     TEXT NOT NULL,
    ADD COLUMN "dateOfBirth"         DATE NOT NULL,
    ADD COLUMN "pickupAddressId"     TEXT NOT NULL,
    ADD COLUMN "businessName"        TEXT,
    ADD COLUMN "siret"               TEXT,
    ADD COLUMN "restaurantFacadeUrl" TEXT,
    ADD COLUMN "cuisineTypes"        "CuisineType"[] NOT NULL DEFAULT ARRAY[]::"CuisineType"[],
    ADD COLUMN "dishTypes"           "DishType"[]    NOT NULL DEFAULT ARRAY[]::"DishType"[],
    ADD COLUMN "hygieneCommitment"   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "faitMaisonCommitment" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "deliveryRadiusKm"    DECIMAL(4, 1) NOT NULL,
    ADD COLUMN "deliveryFeeCents"    INTEGER NOT NULL,
    ADD COLUMN "prepMinMinutes"      INTEGER NOT NULL,
    ADD COLUMN "prepMaxMinutes"      INTEGER NOT NULL,
    ADD COLUMN "neighborhood"        TEXT NOT NULL,
    ADD COLUMN "languageCodes"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "availabilitySchedule" TEXT,
    ADD COLUMN "verifications"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "promoText"           TEXT,
    ADD COLUMN "categoryTag"         TEXT,
    ADD COLUMN "location"            geography(Point, 4326);

CREATE UNIQUE INDEX "SellerProfile_pickupAddressId_key" ON "SellerProfile"("pickupAddressId");
CREATE INDEX "SellerProfile_location_idx" ON "SellerProfile" USING GIST ("location");

-- ============================================================
-- 9. DriverProfile: restructure (drop id, userId is PK)
-- ============================================================

ALTER TABLE "DriverProfile" DROP CONSTRAINT "DriverProfile_pkey";
ALTER TABLE "DriverProfile" DROP COLUMN "id";
DROP INDEX "DriverProfile_userId_key";
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("userId");

-- ============================================================
-- 10. Re-add Listing/Order/Delivery FKs targeting userId
-- ============================================================

ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order"
    ADD CONSTRAINT "Order_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Delivery"
    ADD CONSTRAINT "Delivery_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("userId")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 11. SellerProfile FK to Address (pickup)
-- ============================================================

ALTER TABLE "SellerProfile"
    ADD CONSTRAINT "SellerProfile_pickupAddressId_fkey"
    FOREIGN KEY ("pickupAddressId") REFERENCES "Address"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 12. SellerOpeningHours
-- ============================================================

CREATE TABLE "SellerOpeningHours" (
    "sellerId"  TEXT      NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "startTime" TIME      NOT NULL,
    "endTime"   TIME      NOT NULL,
    CONSTRAINT "SellerOpeningHours_pkey" PRIMARY KEY ("sellerId", "dayOfWeek")
);

ALTER TABLE "SellerOpeningHours"
    ADD CONSTRAINT "SellerOpeningHours_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("userId")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 13. INSERT trigger: auto-approve fait_maison sellers
-- ============================================================

CREATE OR REPLACE FUNCTION "seller_profile_set_kyc_default"()
RETURNS TRIGGER AS $$
BEGIN
    -- Only override the default; if the application explicitly inserts an
    -- already-resolved status (e.g. an admin pre-approving a traiteur),
    -- leave it alone.
    IF NEW."category" = 'FAIT_MAISON' AND NEW."kycStatus" = 'PENDING' THEN
        NEW."kycStatus" := 'APPROVED';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "seller_profile_kyc_default_trigger"
    BEFORE INSERT ON "SellerProfile"
    FOR EACH ROW
    EXECUTE FUNCTION "seller_profile_set_kyc_default"();
