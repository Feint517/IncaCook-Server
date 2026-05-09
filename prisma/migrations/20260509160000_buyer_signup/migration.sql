-- Buyer signup slice:
--   * Replace SellerCategory enum (LE_BON_FAIT_MAISON/ATELIER_TRAITEUR/SAUVE_TON_PANIER → FAIT_MAISON/TRAITEUR/RESTAURANT)
--   * Add Dietary, Allergen, SavedAddressType enums
--   * Convert Listing.dietary/allergens from text[] to typed enum arrays
--   * Add Address and BuyerProfile tables
--
-- Safe to apply only when SellerProfile and Listing tables are empty
-- (any existing rows would fail the SellerCategory cast and lose
-- dietary/allergen data on Listing).

-- 1. Recreate SellerCategory with the doc values.
ALTER TABLE "SellerProfile" ALTER COLUMN "category" TYPE TEXT;
DROP TYPE "SellerCategory";
CREATE TYPE "SellerCategory" AS ENUM ('FAIT_MAISON', 'TRAITEUR', 'RESTAURANT');
ALTER TABLE "SellerProfile" ALTER COLUMN "category" TYPE "SellerCategory" USING "category"::"SellerCategory";

-- 2. New enums.
CREATE TYPE "Dietary" AS ENUM ('HALAL', 'VEGAN', 'GLUTEN_FREE', 'CASHER');

CREATE TYPE "Allergen" AS ENUM (
    'GLUTEN', 'CRUSTACES', 'OEUFS', 'POISSONS', 'ARACHIDES',
    'SOJA', 'LAIT', 'FRUITS_A_COQUE', 'CELERI', 'MOUTARDE',
    'SESAME', 'SULFITES', 'LUPIN', 'MOLLUSQUES'
);

CREATE TYPE "SavedAddressType" AS ENUM ('HOME', 'WORK', 'OTHER');

-- 3. Listing taxonomy: drop the loose text[] columns and replace with typed
--    enum arrays. Listing table is empty so the data loss is a non-issue.
ALTER TABLE "Listing" DROP COLUMN "dietary";
ALTER TABLE "Listing" DROP COLUMN "allergens";
ALTER TABLE "Listing" ADD COLUMN "dietary" "Dietary"[] NOT NULL DEFAULT ARRAY[]::"Dietary"[];
ALTER TABLE "Listing" ADD COLUMN "allergens" "Allergen"[] NOT NULL DEFAULT ARRAY[]::"Allergen"[];

-- 4. Address: shared by buyers (delivery), sellers (pickup), drivers (base)
--    and order delivery destinations.
CREATE TABLE "Address" (
    "id"            TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "type"          "SavedAddressType",
    "customLabel"   TEXT,
    "fullAddress"   TEXT NOT NULL,
    "city"          TEXT NOT NULL,
    "postalCode"    TEXT NOT NULL,
    "point"         geography(Point, 4326),
    "apartment"     TEXT,
    "floor"         TEXT,
    "digicode"      TEXT,
    "deliveryNotes" TEXT,
    "deletedAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Address_userId_idx" ON "Address"("userId");
CREATE INDEX "Address_deletedAt_idx" ON "Address"("deletedAt");
-- GIST index for ST_DWithin / ST_Distance radius queries.
CREATE INDEX "Address_point_idx" ON "Address" USING GIST("point");

ALTER TABLE "Address"
    ADD CONSTRAINT "Address_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. BuyerProfile: 1:1 with User where role = BUYER.
CREATE TABLE "BuyerProfile" (
    "userId"             TEXT NOT NULL,
    "defaultAddressId"   TEXT,
    "dietaryPreferences" "Dietary"[]  NOT NULL DEFAULT ARRAY[]::"Dietary"[],
    "allergies"          "Allergen"[] NOT NULL DEFAULT ARRAY[]::"Allergen"[],
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "BuyerProfile"
    ADD CONSTRAINT "BuyerProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BuyerProfile"
    ADD CONSTRAINT "BuyerProfile_defaultAddressId_fkey"
    FOREIGN KEY ("defaultAddressId") REFERENCES "Address"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
