/**
 * Test-data seed. Idempotent: re-running wipes prior seeded rows (identified
 * by the fixed test supabase UUIDs in scripts/mint-test-jwt.ts) and
 * re-creates them. Safe against the dev DB; do NOT run against production.
 *
 *   pnpm tsx prisma/seed.ts
 *
 * What it creates:
 *   - 1 admin user
 *   - 1 buyer with BuyerProfile + default address (Bastille, Paris 11)
 *   - 1 seller (FAIT_MAISON, auto-approved KYC) with pickup address
 *     (Marais, Paris 4) + 3 listings
 *   - 1 driver (KYC=APPROVED) with base address + bicycle vehicle
 *
 * Stripe identifiers are fake placeholders — payment-related flows that
 * actually hit Stripe will fail with these IDs. For end-to-end Stripe
 * smoke tests, manually create real test-mode Connect accounts.
 */

import { PrismaClient } from '@prisma/client';
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

// Prefer real test-mode Express Connect IDs from env (set in .env.test by
// scripts/setup-stripe-test-accounts.ts). Falls back to obvious placeholders
// if unset — those make transfers fail, which is fine for non-payout tests.
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

  console.log('Creating buyer + default address + profile...');
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
      defaultAddressId: buyerAddressId,
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
      fullAddress: '5 rue des Rosiers',
      city: 'Paris',
      postalCode: '75004',
    },
  });
  await setAddressPoint(sellerAddressId, 48.857, 2.359);
  // FAIT_MAISON auto-approves via the INSERT trigger — we still set
  // kycStatus explicitly for clarity. Stripe Connect onboarding is faked.
  await prisma.sellerProfile.create({
    data: {
      userId: sellerId,
      category: 'FAIT_MAISON',
      displayName: 'Chez Test',
      bio: 'Cuisinière à domicile pour les tests',
      profilePhotoUrl: 'avatars/test-seller.jpg',
      dateOfBirth: new Date('1985-03-12'),
      pickupAddressId: sellerAddressId,
      cuisineTypes: ['FRANCAISE', 'ORIENTALE'],
      dishTypes: ['PLAT', 'DESSERT'],
      hygieneCommitment: true,
      faitMaisonCommitment: true,
      deliveryRadiusKm: 5,
      deliveryFeeCents: 250,
      prepMinMinutes: 20,
      prepMaxMinutes: 35,
      neighborhood: 'Marais, Paris 4ème',
      languageCodes: ['fr', 'en'],
      categoryTag: 'Cuisinière à domicile',
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
      baseAddressId: driverAddressId,
      vehicleType: 'BICYCLE',
      operatingZones: ['Bastille', 'Marais', 'République'],
      charterAccepted: true,
      punctualityCommitment: true,
      careCommitment: true,
      // Manually approve KYC for the test driver (real drivers go through
      // admin review). Stripe Connect onboarding faked.
      kycStatus: 'APPROVED',
      stripeConnectAccountId: SEED_STRIPE_CONNECT_DRIVER,
      stripeOnboardingCompleted: true,
      isOnline: true,
    },
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

  // Children that don't auto-cascade with User delete.
  await prisma.bookmark.deleteMany({ where: { buyerId: { in: userIds } } });

  // Reviews (criteria cascade with Review).
  await prisma.review.deleteMany({
    where: { OR: [{ authorId: { in: userIds } }, { sellerId: { in: userIds } }] },
  });

  // Order chain (OrderItem + OrderItemAddOn cascade with Order;
  // OrderIssue cascades with Delivery).
  const orders = await prisma.order.findMany({
    where: { OR: [{ buyerId: { in: userIds } }, { sellerId: { in: userIds } }] },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length) {
    await prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  // Idempotency keys: tied to user.
  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } });

  // KYC submissions.
  await prisma.kycSubmission.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { reviewerId: { in: userIds } }] },
  });

  // Audit log entries by these actors.
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });

  // Listings + their addOns (cascade), opening hours.
  await prisma.listing.deleteMany({ where: { sellerId: { in: userIds } } });
  await prisma.sellerOpeningHours.deleteMany({ where: { sellerId: { in: userIds } } });

  // Role profiles.
  await prisma.buyerProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.sellerProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.driverProfile.deleteMany({ where: { userId: { in: userIds } } });

  // Addresses (after profiles release their FKs).
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });

  // Finally the users themselves.
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/**
 * Writes the PostGIS point for an existing Address row. Prisma's Unsupported
 * geography(Point, 4326) can't be set through the standard client.
 */
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
