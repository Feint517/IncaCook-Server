-- Orders + payments slice A: order placement, PaymentIntent creation,
-- inventory decrement, payment_intent.* webhook handling.
--
-- Order and OrderItem tables are empty — destructive renames/drops are
-- safe.
--
--   * New enums: FulfillmentChoice (DELIVERY|PICKUP), DeliveryTiming (ASAP|SCHEDULED)
--   * Order: rename shortCode → orderNumber; drop dropoffAddress + dropoffPoint
--     + deliveryFeeCents (replaced by fulfillmentFeeCents); add
--     dropoffAddressId FK, fulfillmentChoice, fulfillmentFeeCents,
--     deliveryTiming, scheduledAt, expectedAt, note,
--     stripePaymentIntentId, inventoryRestored
--   * OrderItem: rename listingTitle/listingImage/unitPriceCents to *Snapshot;
--     drop subtotalCents (derived); add note
--   * New table: OrderItemAddOn

-- ============================================================
-- 1. Enums
-- ============================================================

CREATE TYPE "FulfillmentChoice" AS ENUM ('DELIVERY', 'PICKUP');
CREATE TYPE "DeliveryTiming"    AS ENUM ('ASAP', 'SCHEDULED');

-- ============================================================
-- 2. Order: rename shortCode → orderNumber (column + unique index)
-- ============================================================

ALTER TABLE "Order" RENAME COLUMN "shortCode" TO "orderNumber";
ALTER INDEX "Order_shortCode_key" RENAME TO "Order_orderNumber_key";

-- ============================================================
-- 3. Order: drop deprecated columns
-- ============================================================

ALTER TABLE "Order" DROP COLUMN "dropoffAddress";
ALTER TABLE "Order" DROP COLUMN "dropoffPoint";
-- deliveryFeeCents is being renamed-in-spirit to fulfillmentFeeCents
-- (semantics expand to include pickup-fee=0 case). Drop and re-add.
ALTER TABLE "Order" DROP COLUMN "deliveryFeeCents";

-- ============================================================
-- 4. Order: add new columns
-- ============================================================

ALTER TABLE "Order"
    ADD COLUMN "dropoffAddressId"      TEXT NOT NULL,
    ADD COLUMN "fulfillmentChoice"     "FulfillmentChoice" NOT NULL,
    ADD COLUMN "fulfillmentFeeCents"   INTEGER NOT NULL,
    ADD COLUMN "deliveryTiming"        "DeliveryTiming" NOT NULL DEFAULT 'ASAP',
    ADD COLUMN "scheduledAt"           TIMESTAMP(3),
    ADD COLUMN "expectedAt"            TIMESTAMP(3),
    ADD COLUMN "note"                  TEXT,
    ADD COLUMN "stripePaymentIntentId" TEXT,
    ADD COLUMN "inventoryRestored"     BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Order_stripePaymentIntentId_key"
    ON "Order"("stripePaymentIntentId");

ALTER TABLE "Order"
    ADD CONSTRAINT "Order_dropoffAddressId_fkey"
    FOREIGN KEY ("dropoffAddressId") REFERENCES "Address"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 5. OrderItem: rename snapshot fields, drop derived subtotal, add note
-- ============================================================

ALTER TABLE "OrderItem" RENAME COLUMN "listingTitle"   TO "listingNameSnapshot";
ALTER TABLE "OrderItem" RENAME COLUMN "listingImage"   TO "listingImageUrlSnapshot";
ALTER TABLE "OrderItem" RENAME COLUMN "unitPriceCents" TO "unitPriceCentsSnapshot";
ALTER TABLE "OrderItem" DROP COLUMN "subtotalCents";
ALTER TABLE "OrderItem" ADD COLUMN "note" TEXT;

-- ============================================================
-- 6. OrderItemAddOn (new)
-- ============================================================

CREATE TABLE "OrderItemAddOn" (
    "id"                       TEXT NOT NULL,
    "orderItemId"              TEXT NOT NULL,
    "labelSnapshot"            TEXT NOT NULL,
    "priceDeltaCentsSnapshot"  INTEGER NOT NULL,
    "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItemAddOn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderItemAddOn_orderItemId_idx" ON "OrderItemAddOn"("orderItemId");

ALTER TABLE "OrderItemAddOn"
    ADD CONSTRAINT "OrderItemAddOn_orderItemId_fkey"
    FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
