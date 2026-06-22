import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sql = [
  `CREATE TABLE IF NOT EXISTS "OrderDispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "photoUrls" JSONB,
    "proofFileUrls" JSONB,
    "refundRequested" BOOLEAN NOT NULL DEFAULT false,
    "refundApproved" BOOLEAN NOT NULL DEFAULT false,
    "refundAmountCents" INTEGER,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "OrderDispute_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "OrderDispute_orderId_idx" ON "OrderDispute"("orderId")`,
  `CREATE INDEX IF NOT EXISTS "OrderDispute_status_idx" ON "OrderDispute"("status")`,
  `CREATE INDEX IF NOT EXISTS "OrderDispute_buyerId_idx" ON "OrderDispute"("buyerId")`,
];
async function main() {
  for (const s of sql) await prisma.$executeRawUnsafe(s);
  console.log('OrderDispute table applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
