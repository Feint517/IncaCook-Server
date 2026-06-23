import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const stmts = [
  `ALTER TYPE "CatalogOrderStatus" ADD VALUE IF NOT EXISTS 'REFUNDED'`,
  `ALTER TABLE "CatalogOrder" ADD COLUMN IF NOT EXISTS "stripeRefundId" TEXT`,
  `CREATE TABLE IF NOT EXISTS "CatalogClaim" (
    "id" TEXT NOT NULL,
    "catalogOrderId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "photoUrls" JSONB,
    "adminNotes" TEXT,
    "refundAmountCents" INTEGER,
    "replacementNotes" TEXT,
    "stripeRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "CatalogClaim_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "CatalogClaim_catalogOrderId_idx" ON "CatalogClaim"("catalogOrderId")`,
  `CREATE INDEX IF NOT EXISTS "CatalogClaim_sellerId_idx" ON "CatalogClaim"("sellerId")`,
  `CREATE INDEX IF NOT EXISTS "CatalogClaim_status_idx" ON "CatalogClaim"("status")`,
];
async function main() {
  // ALTER TYPE ADD VALUE cannot run inside a transaction with other statements; run sequentially.
  for (const s of stmts) await prisma.$executeRawUnsafe(s);
  console.log('CatalogClaim SAV schema applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
