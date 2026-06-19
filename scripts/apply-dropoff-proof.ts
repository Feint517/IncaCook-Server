import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sql = [
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveryToken" TEXT`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredConfirmedAt" TIMESTAMP(3)`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredConfirmedByDriverId" TEXT`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredLat" DOUBLE PRECISION`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredLng" DOUBLE PRECISION`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Delivery_deliveryToken_key" ON "Delivery"("deliveryToken")`,
];
async function main() {
  for (const s of sql) await prisma.$executeRawUnsafe(s);
  console.log('Delivery dropoff-proof columns applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
