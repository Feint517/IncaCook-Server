import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sql = [
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupToken" TEXT`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupConfirmedAt" TIMESTAMP(3)`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupConfirmedByDriverId" TEXT`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupLat" DOUBLE PRECISION`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "pickupLng" DOUBLE PRECISION`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Delivery_pickupToken_key" ON "Delivery"("pickupToken")`,
];
async function main() {
  for (const s of sql) await prisma.$executeRawUnsafe(s);
  console.log('Delivery pickup-proof columns applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
