import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sql = [
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableReason" TEXT`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableAt" TIMESTAMP(3)`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableLat" DOUBLE PRECISION`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableLng" DOUBLE PRECISION`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailableNote" TEXT`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "sellerUnavailablePhotoUrl" TEXT`,
];
async function main() {
  for (const s of sql) await prisma.$executeRawUnsafe(s);
  console.log('Delivery seller-unavailable columns applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
