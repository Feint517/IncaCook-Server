-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BUYER', 'SELLER', 'DRIVER', 'ADMIN', 'MODERATOR');

-- CreateEnum
CREATE TYPE "SellerCategory" AS ENUM ('LE_BON_FAIT_MAISON', 'ATELIER_TRAITEUR', 'SAUVE_TON_PANIER');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CourseType" AS ENUM ('STARTER', 'MAIN_COURSE', 'DESSERT', 'SNACK', 'BEVERAGE', 'SIDE_DISH', 'FULL_MEAL', 'BAKERY');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'EXPIRED', 'SOLD_OUT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('UNASSIGNED', 'SEARCHING', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'PICKED_UP', 'EN_ROUTE_TO_DROPOFF', 'AT_DROPOFF', 'DELIVERED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "supabaseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'BUYER',
    "displayName" TEXT NOT NULL,
    "avatarPath" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "SellerCategory" NOT NULL,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bio" TEXT,
    "kitchenNotes" TEXT,
    "pickupAddress" TEXT NOT NULL,
    "pickupPoint" geography(Point, 4326),
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "stripeAccountId" TEXT,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "stripeAccountId" TEXT,
    "lastKnownPoint" geography(Point, 4326),
    "lastSeenAt" TIMESTAMP(3),
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "averageRating" DOUBLE PRECISION,
    "totalDeliveries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imagePaths" TEXT[],
    "priceCents" INTEGER NOT NULL,
    "quantityAvailable" INTEGER NOT NULL DEFAULT 1,
    "cuisines" TEXT[],
    "dietary" TEXT[],
    "allergens" TEXT[],
    "courseType" "CourseType" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "preparedAt" TIMESTAMP(3),
    "pickupWindowStart" TIMESTAMP(3),
    "pickupWindowEnd" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotalCents" INTEGER NOT NULL,
    "deliveryFeeCents" INTEGER NOT NULL,
    "commissionRateBps" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "sellerEarningsCents" INTEGER NOT NULL,
    "buyerTotalCents" INTEGER NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "dropoffPoint" geography(Point, 4326) NOT NULL,
    "deliveryInstructions" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "listingTitle" TEXT NOT NULL,
    "listingImage" TEXT,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "pickupEta" TIMESTAMP(3),
    "dropoffEta" TIMESTAMP(3),
    "driverAssignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "proofOfDeliveryPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "correlationId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_supabaseId_key" ON "User"("supabaseId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SellerProfile_userId_key" ON "SellerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerProfile_slug_key" ON "SellerProfile"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SellerProfile_stripeAccountId_key" ON "SellerProfile"("stripeAccountId");

-- CreateIndex
CREATE INDEX "SellerProfile_category_idx" ON "SellerProfile"("category");

-- CreateIndex
CREATE INDEX "SellerProfile_kycStatus_idx" ON "SellerProfile"("kycStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_stripeAccountId_key" ON "DriverProfile"("stripeAccountId");

-- CreateIndex
CREATE INDEX "DriverProfile_isOnline_idx" ON "DriverProfile"("isOnline");

-- CreateIndex
CREATE INDEX "DriverProfile_kycStatus_idx" ON "DriverProfile"("kycStatus");

-- CreateIndex
CREATE INDEX "Listing_sellerId_status_expiresAt_idx" ON "Listing"("sellerId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Listing_status_expiresAt_idx" ON "Listing"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Listing_deletedAt_idx" ON "Listing"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shortCode_key" ON "Order"("shortCode");

-- CreateIndex
CREATE INDEX "Order_buyerId_createdAt_idx" ON "Order"("buyerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Order_sellerId_createdAt_idx" ON "Order"("sellerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_listingId_idx" ON "OrderItem"("listingId");

-- CreateIndex
CREATE INDEX "Delivery_orderId_idx" ON "Delivery"("orderId");

-- CreateIndex
CREATE INDEX "Delivery_driverId_status_idx" ON "Delivery"("driverId", "status");

-- CreateIndex
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");

-- AddForeignKey
ALTER TABLE "SellerProfile" ADD CONSTRAINT "SellerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "SellerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- PostGIS GIST indexes for radius queries.
-- Prisma cannot manage indexes on `Unsupported` columns, so we add them here
-- by hand. Every subsequent migration touching these tables must preserve the
-- index — `prisma migrate diff` will not regenerate it.
-- ----------------------------------------------------------------------------

CREATE INDEX "SellerProfile_pickupPoint_idx" ON "SellerProfile" USING GIST ("pickupPoint");

CREATE INDEX "DriverProfile_lastKnownPoint_idx" ON "DriverProfile" USING GIST ("lastKnownPoint");

CREATE INDEX "Order_dropoffPoint_idx" ON "Order" USING GIST ("dropoffPoint");

