-- Seller ↔ driver chat: add the SELLER_DRIVER conversation type.
-- Idempotent so it's safe to re-run / reconcile across environments.
ALTER TYPE "ConversationType" ADD VALUE IF NOT EXISTS 'SELLER_DRIVER';
