-- Reviews phase 1: Review + ReviewCriterionRating + denormalized counters
-- on SellerProfile.
--
-- The denormalized averageRating + reviewCount on SellerProfile let the
-- buyer feed sort by rating without joining the reviews table. They're
-- recomputed inside the same transaction that inserts a new review.

-- ============================================================
-- 1. Enum
-- ============================================================

CREATE TYPE "RatingCriterion" AS ENUM ('HYGIENE', 'FOOD_QUALITY', 'PACKAGING');

-- ============================================================
-- 2. SellerProfile: cache reviewCount alongside the existing averageRating
-- ============================================================

ALTER TABLE "SellerProfile"
    ADD COLUMN "reviewCount" INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 3. Review
-- ============================================================

CREATE TABLE "Review" (
    "id"           TEXT NOT NULL,
    "orderId"      TEXT NOT NULL,
    "authorId"     TEXT NOT NULL,
    "sellerId"     TEXT NOT NULL,
    "rating"       INTEGER NOT NULL,
    "body"         TEXT NOT NULL,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");
CREATE INDEX "Review_sellerId_createdAt_idx" ON "Review"("sellerId", "createdAt" DESC);
CREATE INDEX "Review_authorId_createdAt_idx" ON "Review"("authorId", "createdAt" DESC);

-- 1–5 stars only.
ALTER TABLE "Review"
    ADD CONSTRAINT "Review_rating_range"
    CHECK ("rating" >= 1 AND "rating" <= 5);

ALTER TABLE "Review"
    ADD CONSTRAINT "Review_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Review"
    ADD CONSTRAINT "Review_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Review"
    ADD CONSTRAINT "Review_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("userId")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 4. ReviewCriterionRating
-- ============================================================

CREATE TABLE "ReviewCriterionRating" (
    "reviewId"    TEXT NOT NULL,
    "criterion"   "RatingCriterion" NOT NULL,
    "value"       DECIMAL(4, 1) NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ReviewCriterionRating_pkey" PRIMARY KEY ("reviewId", "criterion")
);

ALTER TABLE "ReviewCriterionRating"
    ADD CONSTRAINT "ReviewCriterionRating_reviewId_fkey"
    FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- value is non-negative; cap is enforced by the application boundary
-- (score5 → 0–5; percent → 0–100), so we don't pin a max here.
ALTER TABLE "ReviewCriterionRating"
    ADD CONSTRAINT "ReviewCriterionRating_value_nonneg"
    CHECK ("value" >= 0);
