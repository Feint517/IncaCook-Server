-- New WalletEntryType for driver refund-clawback debt. ADD VALUE is idempotent-safe.
ALTER TYPE "WalletEntryType" ADD VALUE IF NOT EXISTS 'DRIVER_DEBT';
