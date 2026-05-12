-- Pivot from IBAN-storage to Stripe Connect for payouts.
--
-- Schema changes only. Stripe Connect onboarding endpoints + webhook
-- handler land in the next slice.
--
--   * User: add stripeCustomerId (nullable, populated lazily on first payment)
--   * SellerProfile: rename stripeAccountId → stripeConnectAccountId,
--     add stripeOnboardingCompleted bool
--   * DriverProfile: drop ibanEncrypted + ibanHolderName,
--     rename stripeAccountId → stripeConnectAccountId,
--     add stripeOnboardingCompleted bool

-- ============================================================
-- 1. User: add stripeCustomerId
-- ============================================================

ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- ============================================================
-- 2. SellerProfile: rename stripeAccountId → stripeConnectAccountId,
--    add stripeOnboardingCompleted
-- ============================================================

ALTER INDEX "SellerProfile_stripeAccountId_key"
    RENAME TO "SellerProfile_stripeConnectAccountId_key";

ALTER TABLE "SellerProfile"
    RENAME COLUMN "stripeAccountId" TO "stripeConnectAccountId";

ALTER TABLE "SellerProfile"
    ADD COLUMN "stripeOnboardingCompleted" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 3. DriverProfile: drop IBAN columns, rename stripe field, add flag
-- ============================================================

ALTER TABLE "DriverProfile" DROP COLUMN "ibanEncrypted";
ALTER TABLE "DriverProfile" DROP COLUMN "ibanHolderName";

ALTER INDEX "DriverProfile_stripeAccountId_key"
    RENAME TO "DriverProfile_stripeConnectAccountId_key";

ALTER TABLE "DriverProfile"
    RENAME COLUMN "stripeAccountId" TO "stripeConnectAccountId";

ALTER TABLE "DriverProfile"
    ADD COLUMN "stripeOnboardingCompleted" BOOLEAN NOT NULL DEFAULT false;
