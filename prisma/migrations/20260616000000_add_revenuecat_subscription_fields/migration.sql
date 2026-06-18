-- RevenueCat seller subscription (App Store / Google Play).
-- Purely additive: a new EXPIRED status value + nullable columns on
-- SellerProfile. No data is dropped or rewritten; existing Stripe payout /
-- wallet / order-payment columns are untouched.

-- New subscription status for a lapsed RevenueCat subscription.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- RevenueCat subscription mirror columns. They feed the SAME gate fields
-- (subscriptionStatus / subscriptionCurrentPeriodEnd / isPremium) the listing
-- and commission logic already read, so no other table changes are needed.
ALTER TABLE "SellerProfile"
  ADD COLUMN "revenueCatCustomerId"  TEXT,
  ADD COLUMN "revenueCatEntitlement" TEXT,
  ADD COLUMN "subscriptionPlan"      TEXT,
  ADD COLUMN "subscriptionProductId" TEXT,
  ADD COLUMN "subscriptionCategory"  "SellerCategory",
  ADD COLUMN "trialEndsAt"           TIMESTAMP(3);
