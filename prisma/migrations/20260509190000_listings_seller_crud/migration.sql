-- Catalog slice A: Listing schema expansion + ListingAddOn + storage RLS.
--
-- The Listing table is empty so destructive column changes are safe.

-- ============================================================
-- 1. New enum
-- ============================================================

CREATE TYPE "Fulfillment" AS ENUM ('DELIVERY', 'PICKUP', 'BOTH');

-- ============================================================
-- 2. Listing: drop old columns + indexes
-- ============================================================

DROP INDEX IF EXISTS "Listing_sellerId_status_expiresAt_idx";
DROP INDEX IF EXISTS "Listing_status_expiresAt_idx";

ALTER TABLE "Listing" DROP COLUMN "title";
ALTER TABLE "Listing" DROP COLUMN "imagePaths";
ALTER TABLE "Listing" DROP COLUMN "quantityAvailable";
ALTER TABLE "Listing" DROP COLUMN "status";
ALTER TABLE "Listing" DROP COLUMN "preparedAt";
ALTER TABLE "Listing" DROP COLUMN "pickupWindowStart";
ALTER TABLE "Listing" DROP COLUMN "pickupWindowEnd";

-- ============================================================
-- 3. Drop ListingStatus enum (no longer referenced)
-- ============================================================

DROP TYPE "ListingStatus";

-- ============================================================
-- 4. Listing: add new columns
-- ============================================================

ALTER TABLE "Listing"
    ADD COLUMN "name"               TEXT NOT NULL,
    ADD COLUMN "imageUrls"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "originalPriceCents" INTEGER,
    ADD COLUMN "discountPercent"    INTEGER,
    ADD COLUMN "portionsLeft"       INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "otherAllergens"     TEXT,
    ADD COLUMN "isAvailable"        BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "isVeg"              BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "menuCategory"       TEXT,
    ADD COLUMN "category"           "SellerCategory" NOT NULL,
    ADD COLUMN "fulfillment"        "Fulfillment" NOT NULL,
    ADD COLUMN "prepMinutes"        INTEGER NOT NULL;

-- ============================================================
-- 5. Listing: integrity constraints
-- ============================================================

-- Cap imageUrls at 3 entries (matches Flutter app's 3-image limit).
ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_imageUrls_max3"
    CHECK (array_length("imageUrls", 1) IS NULL OR array_length("imageUrls", 1) <= 3);

ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_discountPercent_range"
    CHECK ("discountPercent" IS NULL OR ("discountPercent" >= 0 AND "discountPercent" <= 100));

ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_originalPrice_gte_price"
    CHECK ("originalPriceCents" IS NULL OR "originalPriceCents" >= "priceCents");

ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_portionsLeft_nonneg"
    CHECK ("portionsLeft" >= 0);

ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_prepMinutes_nonneg"
    CHECK ("prepMinutes" >= 0);

-- ============================================================
-- 6. Listing: new indexes
-- ============================================================

CREATE INDEX "Listing_sellerId_isAvailable_expiresAt_idx"
    ON "Listing"("sellerId", "isAvailable", "expiresAt");

CREATE INDEX "Listing_isAvailable_expiresAt_idx"
    ON "Listing"("isAvailable", "expiresAt");

CREATE INDEX "Listing_category_isAvailable_expiresAt_idx"
    ON "Listing"("category", "isAvailable", "expiresAt");

-- ============================================================
-- 7. ListingAddOn table
-- ============================================================

CREATE TABLE "ListingAddOn" (
    "id"                  TEXT      NOT NULL,
    "listingId"           TEXT      NOT NULL,
    "label"               TEXT      NOT NULL,
    "priceDeltaCents"     INTEGER   NOT NULL,
    "isSelectedByDefault" BOOLEAN   NOT NULL DEFAULT false,
    "sortOrder"           INTEGER   NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ListingAddOn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ListingAddOn_listingId_sortOrder_idx"
    ON "ListingAddOn"("listingId", "sortOrder");

ALTER TABLE "ListingAddOn"
    ADD CONSTRAINT "ListingAddOn_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 8. Storage RLS for the listings/ bucket
--
-- Path convention: listings/<supabase_user_id>/<filename>
-- - Read: public (anonymous + authenticated). Buyer feed needs to display
--   images without auth round-trips.
-- - Write/Update/Delete: owner only (foldername[1] == auth.uid()).
--
-- The bucket itself must exist in storage.buckets — create via Supabase
-- dashboard. Policies attach to storage.objects regardless.
-- ============================================================

CREATE POLICY "listings_public_select" ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'listings');

CREATE POLICY "listings_owner_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'listings'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "listings_owner_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'listings'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "listings_owner_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'listings'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
