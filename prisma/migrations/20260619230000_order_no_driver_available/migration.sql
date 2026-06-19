-- New transient OrderStatus value for the no-driver-available fallback.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'NO_DRIVER_AVAILABLE';
