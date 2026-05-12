-- Slice B: seller-side order lifecycle. Adds Stripe refund tracking on
-- Order so seller cancellations can issue (and idempotently track) the
-- buyer's refund.

ALTER TABLE "Order"
    ADD COLUMN "stripeRefundId" TEXT,
    ADD COLUMN "refundedAt"     TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_stripeRefundId_key" ON "Order"("stripeRefundId");
