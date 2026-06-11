-- Raise the per-listing image cap from 3 to 4 (matches the app's 4-image picker).
ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "Listing_imageUrls_max3";

ALTER TABLE "Listing"
    ADD CONSTRAINT "Listing_imageUrls_max4"
    CHECK (array_length("imageUrls", 1) IS NULL OR array_length("imageUrls", 1) <= 4);
