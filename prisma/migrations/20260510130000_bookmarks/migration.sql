-- Bookmarks: a buyer's saved listings.
-- Composite PK on (buyerId, listingId) means duplicate POSTs are no-ops.
-- Cascades on listing delete (no point keeping a bookmark to a removed
-- listing). User deletes are RESTRICT — User.deletedAt is a soft-delete
-- and we want bookmark history retained if the user is restored.

CREATE TABLE "Bookmark" (
    "buyerId"   TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("buyerId", "listingId")
);

CREATE INDEX "Bookmark_buyerId_createdAt_idx"
    ON "Bookmark"("buyerId", "createdAt" DESC);

-- For SellerStats.mealsSaved (count of bookmarks across the seller's listings).
CREATE INDEX "Bookmark_listingId_idx" ON "Bookmark"("listingId");

ALTER TABLE "Bookmark"
    ADD CONSTRAINT "Bookmark_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Bookmark"
    ADD CONSTRAINT "Bookmark_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
