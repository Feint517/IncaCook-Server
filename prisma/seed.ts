/**
 * Test-data seed. Idempotent: re-running wipes prior seeded rows (identified
 * by the fixed test supabase UUIDs in scripts/mint-test-jwt.ts) and
 * re-creates them. Safe against the dev DB; do NOT run against production.
 *
 *   pnpm tsx prisma/seed.ts
 *
 * Post-Phase A the data model assumes role profile rows are created as
 * empty stubs at Gate 2 and then progressively filled in via per-concept
 * PUT endpoints. The seed is the only place that fast-forwards a user all
 * the way to "fully onboarded" without going through the wizard — it
 * writes directly to the role profile, SellerBusiness, SellerCuisine,
 * SellerDish, DriverZone, KycDocument, UserCharter, and Address (with
 * kind) tables so the smoke test has a complete user to act as.
 *
 * What it creates:
 *   - 1 admin user
 *   - 1 buyer with BuyerProfile + a BUYER_DELIVERY Address (Bastille)
 *   - 1 seller (FAIT_MAISON, auto-approved KYC) with a SELLER_PICKUP
 *     Address (Marais), cuisines/dishes joins, charters, 3 listings.
 *     Fait-maison sellers have no SellerBusiness row.
 *   - 1 driver (KYC=APPROVED) with a DRIVER_HOME Address, BICYCLE vehicle,
 *     three zone rows, charters, all three KYC documents APPROVED.
 *
 * Stripe Connect IDs come from .env.test (real test-mode accounts) when
 * set; otherwise fall back to obvious placeholders that make transfers
 * fail (fine for non-payout tests).
 */

import {
  AddressKind,
  CharterKind,
  KycDocType,
  KycStatus,
  PrismaClient,
} from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient();

// Must match scripts/mint-test-jwt.ts so JWT `sub` claims resolve here.
const TEST_SUPABASE_IDS = {
  admin: '00000000-0000-0000-0000-000000000001',
  buyer: '00000000-0000-0000-0000-000000000002',
  seller: '00000000-0000-0000-0000-000000000003',
  driver: '00000000-0000-0000-0000-000000000004',
} as const;

const TEST_EMAILS = {
  admin: 'test+admin@incacook.test',
  buyer: 'test+buyer@incacook.test',
  seller: 'test+seller@incacook.test',
  driver: 'test+driver@incacook.test',
} as const;

const SEED_STRIPE_CONNECT_SELLER =
  process.env.TEST_SELLER_STRIPE_ACCOUNT_ID ?? 'acct_test_seed_seller';
const SEED_STRIPE_CONNECT_DRIVER =
  process.env.TEST_DRIVER_STRIPE_ACCOUNT_ID ?? 'acct_test_seed_driver';

async function main(): Promise<void> {
  console.log('Wiping prior seeded data...');
  await cleanup();

  console.log('Creating admin...');
  const adminId = ulid();
  await prisma.user.create({
    data: {
      id: adminId,
      supabaseId: TEST_SUPABASE_IDS.admin,
      email: TEST_EMAILS.admin,
      firstName: 'Test',
      lastName: 'Admin',
      role: 'ADMIN',
      emailVerified: true,
      acceptedCgu: true,
      acceptedCgv: true,
      acceptedAt: new Date(),
    },
  });

  console.log('Creating buyer + BUYER_DELIVERY address + profile...');
  const buyerId = ulid();
  const buyerAddressId = ulid();
  await prisma.user.create({
    data: {
      id: buyerId,
      supabaseId: TEST_SUPABASE_IDS.buyer,
      email: TEST_EMAILS.buyer,
      firstName: 'Test',
      lastName: 'Buyer',
      role: 'BUYER',
      emailVerified: true,
      acceptedCgu: true,
      acceptedCgv: true,
      acceptedAt: new Date(),
    },
  });
  await prisma.address.create({
    data: {
      id: buyerAddressId,
      userId: buyerId,
      kind: AddressKind.BUYER_DELIVERY,
      type: 'HOME',
      fullAddress: '12 rue de la Bastille',
      city: 'Paris',
      postalCode: '75011',
    },
  });
  await setAddressPoint(buyerAddressId, 48.853, 2.369);
  await prisma.buyerProfile.create({
    data: {
      userId: buyerId,
      dietaryPreferences: ['HALAL'],
      allergies: ['ARACHIDES'],
    },
  });

  console.log('Creating seller (FAIT_MAISON, auto-approved KYC)...');
  const sellerId = ulid();
  const sellerAddressId = ulid();
  await prisma.user.create({
    data: {
      id: sellerId,
      supabaseId: TEST_SUPABASE_IDS.seller,
      email: TEST_EMAILS.seller,
      firstName: 'Test',
      lastName: 'Seller',
      role: 'SELLER',
      emailVerified: true,
      acceptedCgu: true,
      acceptedCgv: true,
      acceptedAt: new Date(),
    },
  });
  await prisma.address.create({
    data: {
      id: sellerAddressId,
      userId: sellerId,
      kind: AddressKind.SELLER_PICKUP,
      fullAddress: '5 rue des Rosiers',
      city: 'Paris',
      postalCode: '75004',
    },
  });
  await setAddressPoint(sellerAddressId, 48.857, 2.359);
  await prisma.sellerProfile.create({
    data: {
      userId: sellerId,
      category: 'FAIT_MAISON',
      displayName: 'Chez Test',
      bio: 'Cuisinière à domicile pour les tests',
      profilePhotoUrl: 'avatars/test-seller.jpg',
      dateOfBirth: new Date('1985-03-12'),
      hygieneCommitment: true,
      faitMaisonCommitment: true,
      deliveryRadiusKm: 5,
      deliveryFeeCents: 250,
      prepMinMinutes: 20,
      prepMaxMinutes: 35,
      neighborhood: 'Marais, Paris 4ème',
      languageCodes: ['fr', 'en'],
      categoryTag: 'Cuisinière à domicile',
      kycStatus: KycStatus.APPROVED,
      stripeConnectAccountId: SEED_STRIPE_CONNECT_SELLER,
      stripeOnboardingCompleted: true,
    },
  });
  // Denormalize pickup point onto SellerProfile.location for feed radius.
  await prisma.$executeRaw`
    UPDATE "SellerProfile"
    SET "location" = (SELECT "point" FROM "Address" WHERE "id" = ${sellerAddressId})
    WHERE "userId" = ${sellerId}
  `;
  // Cuisine + dish joins.
  await prisma.sellerCuisine.createMany({
    data: [
      { userId: sellerId, cuisineType: 'FRANCAISE' },
      { userId: sellerId, cuisineType: 'ORIENTALE' },
    ],
  });
  await prisma.sellerDish.createMany({
    data: [
      { userId: sellerId, dishType: 'PLAT' },
      { userId: sellerId, dishType: 'DESSERT' },
    ],
  });
  // Fait-maison sellers have no SellerBusiness row (skipped step) — that's
  // the whole point of the fait-maison branch.
  // Charters: hygiene + fait-maison.
  await prisma.userCharter.createMany({
    data: [
      { userId: sellerId, charter: CharterKind.HYGIENE, version: 'v1.0' },
      { userId: sellerId, charter: CharterKind.FAIT_MAISON, version: 'v1.0' },
    ],
  });

  console.log('Creating driver (KYC=APPROVED, BICYCLE)...');
  const driverId = ulid();
  const driverAddressId = ulid();
  await prisma.user.create({
    data: {
      id: driverId,
      supabaseId: TEST_SUPABASE_IDS.driver,
      email: TEST_EMAILS.driver,
      firstName: 'Test',
      lastName: 'Driver',
      role: 'DRIVER',
      emailVerified: true,
      acceptedCgu: true,
      acceptedCgv: true,
      acceptedAt: new Date(),
    },
  });
  await prisma.address.create({
    data: {
      id: driverAddressId,
      userId: driverId,
      kind: AddressKind.DRIVER_HOME,
      fullAddress: '8 boulevard de Belleville',
      city: 'Paris',
      postalCode: '75011',
    },
  });
  await setAddressPoint(driverAddressId, 48.87, 2.382);
  await prisma.driverProfile.create({
    data: {
      userId: driverId,
      dateOfBirth: new Date('1996-04-22'),
      vehicleType: 'BICYCLE',
      charterAccepted: true,
      punctualityCommitment: true,
      careCommitment: true,
      kycStatus: KycStatus.APPROVED,
      stripeConnectAccountId: SEED_STRIPE_CONNECT_DRIVER,
      stripeOnboardingCompleted: true,
      isOnline: true,
    },
  });
  await prisma.driverZone.createMany({
    data: [
      { userId: driverId, zoneId: 'Bastille' },
      { userId: driverId, zoneId: 'Marais' },
      { userId: driverId, zoneId: 'République' },
    ],
  });
  // Driver KYC: ID front/back + selfie, all pre-approved for the smoke test.
  // (Bicycle → no DRIVING_LICENSE / CARTE_GRISE / INSURANCE.)
  const driverKycMetadata = { idDocumentType: 'CARTE_IDENTITE' };
  await prisma.kycDocument.createMany({
    data: [
      {
        id: ulid(),
        userId: driverId,
        type: KycDocType.ID_FRONT,
        fileUrl: 'kyc/test-driver/id-front.jpg',
        reviewState: KycStatus.APPROVED,
        metadata: driverKycMetadata,
      },
      {
        id: ulid(),
        userId: driverId,
        type: KycDocType.ID_BACK,
        fileUrl: 'kyc/test-driver/id-back.jpg',
        reviewState: KycStatus.APPROVED,
        metadata: driverKycMetadata,
      },
      {
        id: ulid(),
        userId: driverId,
        type: KycDocType.SELFIE,
        fileUrl: 'kyc/test-driver/selfie.jpg',
        reviewState: KycStatus.APPROVED,
      },
    ],
  });
  // Driver charters: punctuality + care.
  await prisma.userCharter.createMany({
    data: [
      { userId: driverId, charter: CharterKind.PUNCTUALITY, version: 'v1.0' },
      { userId: driverId, charter: CharterKind.CARE, version: 'v1.0' },
    ],
  });

  console.log('Creating sample listings...');
  await prisma.listing.createMany({
    data: [
      {
        id: ulid(),
        sellerId,
        name: 'Couscous Royal',
        description: 'Couscous traditionnel avec agneau, merguez et poulet',
        imageUrls: ['listings/sample-couscous.jpg'],
        priceCents: 1500,
        portionsLeft: 5,
        dietaryTags: ['HALAL'],
        allergens: ['CELERI'],
        isAvailable: true,
        isVeg: false,
        category: 'FAIT_MAISON',
        fulfillment: 'BOTH',
        prepMinutes: 35,
        cuisineType: 'ORIENTALE',
        dishType: 'PLAT',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7d
      },
      {
        id: ulid(),
        sellerId,
        name: 'Salade Niçoise',
        description: 'Salade fraîche aux légumes, œuf, et thon',
        imageUrls: ['listings/sample-salade.jpg'],
        priceCents: 950,
        portionsLeft: 3,
        dietaryTags: [],
        allergens: ['OEUFS', 'POISSONS'],
        isAvailable: true,
        isVeg: false,
        category: 'FAIT_MAISON',
        fulfillment: 'BOTH',
        prepMinutes: 15,
        cuisineType: 'FRANCAISE',
        dishType: 'PLAT',
        expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: ulid(),
        sellerId,
        name: 'Tarte aux Pommes',
        description: 'Tarte maison aux pommes du verger',
        imageUrls: ['listings/sample-tarte.jpg'],
        priceCents: 500,
        originalPriceCents: 700,
        discountPercent: 28,
        portionsLeft: 8,
        dietaryTags: ['VEGAN'],
        allergens: ['GLUTEN'],
        isAvailable: true,
        isVeg: true,
        category: 'FAIT_MAISON',
        fulfillment: 'PICKUP',
        prepMinutes: 5,
        cuisineType: 'FRANCAISE',
        dishType: 'DESSERT',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    ],
  });

  console.log('Seed complete.');
  console.log('');
  console.log('Mint a JWT with:  pnpm tsx scripts/mint-test-jwt.ts <admin|buyer|seller|driver>');
}

/**
 * Wipes any prior seeded rows. Uses the fixed test supabaseIds as the
 * anchor. FK-safe deletion order (most-dependent first).
 */
async function cleanup(): Promise<void> {
  const supabaseIds = Object.values(TEST_SUPABASE_IDS);
  const users = await prisma.user.findMany({
    where: { supabaseId: { in: supabaseIds } },
    select: { id: true },
  });
  if (users.length === 0) {
    return;
  }
  const userIds = users.map((u) => u.id);

  await prisma.bookmark.deleteMany({ where: { buyerId: { in: userIds } } });

  await prisma.review.deleteMany({
    where: { OR: [{ authorId: { in: userIds } }, { sellerId: { in: userIds } }] },
  });

  const orders = await prisma.order.findMany({
    where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) {
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } });

  // KYC documents (replaces KycSubmission). reviewer FK cascades on User
  // delete with ON DELETE SET NULL, but we wipe explicitly for cleanliness.
  await prisma.kycDocument.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { reviewerId: { in: userIds } }] },
  });

  // Charters by user.
  await prisma.userCharter.deleteMany({ where: { userId: { in: userIds } } });

  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });

  // Listings + their addOns (cascade).
  await prisma.listing.deleteMany({ where: { sellerId: { in: userIds } } });

  // Seller-specific child rows. Opening hours hang off SellerBusiness now;
  // deleting SellerBusiness cascades them.
  await prisma.sellerBusiness.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.sellerCuisine.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.sellerDish.deleteMany({ where: { userId: { in: userIds } } });

  // Driver zones.
  await prisma.driverZone.deleteMany({ where: { userId: { in: userIds } } });

  // Role profiles.
  await prisma.buyerProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.sellerProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });

  // Addresses (after profiles release their FKs — though Phase A removed
  // the FKs from profiles to Address; still safest to wipe addresses
  // after the things that reference them by userId).
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });

  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function setAddressPoint(addressId: string, lat: number, lng: number): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Address"
    SET "point" = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
    WHERE "id" = ${addressId}
  `;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
