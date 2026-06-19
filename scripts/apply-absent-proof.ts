import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sql = [
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveredAsAbsent" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofPhotoUrl" TEXT`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofLat" DOUBLE PRECISION`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofLng" DOUBLE PRECISION`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofTakenAt" TIMESTAMP(3)`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofContactAttemptedAt" TIMESTAMP(3)`,
  `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "absentProofNote" TEXT`,
];
async function main() {
  for (const s of sql) await prisma.$executeRawUnsafe(s);
  console.log('Delivery absent-proof columns applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
