-- Posting module phase 1a: pluralize cuisine/dish on Listing, allow
-- nullable expiresAt + portionsLeft for restaurant/traiteur cook-to-order
-- and permanent-menu use cases.
-- See docs/posting-module.md §4.3, §4.5.
--
-- The Listing table is empty so destructive column changes are safe;
-- backfill statements are kept for forward-compatibility regardless.

-- ============================================================
-- 1. Add the new array columns
-- ============================================================

ALTER TABLE "Listing"
    ADD COLUMN "cuisineTypes" "CuisineType"[] NOT NULL DEFAULT ARRAY[]::"CuisineType"[],
    ADD COLUMN "dishTypes"    "DishType"[]    NOT NULL DEFAULT ARRAY[]::"DishType"[];

-- ============================================================
-- 2. Backfill from the singular columns
-- ============================================================

UPDATE "Listing"
SET "cuisineTypes" = CASE WHEN "cuisineType" IS NULL THEN ARRAY[]::"CuisineType"[]
                          ELSE ARRAY["cuisineType"] END,
    "dishTypes"    = CASE WHEN "dishType"    IS NULL THEN ARRAY[]::"DishType"[]
                          ELSE ARRAY["dishType"]    END;

-- ============================================================
-- 3. Drop the singular columns
-- ============================================================

ALTER TABLE "Listing"
    DROP COLUMN "cuisineType",
    DROP COLUMN "dishType";

-- ============================================================
-- 4. GIN indexes for the array columns (filter perf)
-- ============================================================

CREATE INDEX "Listing_cuisineTypes_gin" ON "Listing" USING GIN ("cuisineTypes");
CREATE INDEX "Listing_dishTypes_gin"    ON "Listing" USING GIN ("dishTypes");

-- ============================================================
-- 5. Make expiresAt + portionsLeft nullable
--
-- expiresAt    NULL → permanent menu item (restaurant/traiteur)
-- portionsLeft NULL → "cook to order", no inventory (restaurant/traiteur)
--
-- API-layer validation in POST /v1/listings enforces "required for
-- fait_maison" (see docs/posting-module.md §3.3).
-- ============================================================

ALTER TABLE "Listing"
    ALTER COLUMN "expiresAt"    DROP NOT NULL,
    ALTER COLUMN "portionsLeft" DROP NOT NULL,
    ALTER COLUMN "portionsLeft" DROP DEFAULT;
