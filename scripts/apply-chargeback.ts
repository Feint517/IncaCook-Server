import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sql = [
  `ALTER TABLE "OrderDispute" ADD COLUMN IF NOT EXISTS "stripeDisputeId" TEXT`,
  `ALTER TABLE "OrderDispute" ADD COLUMN IF NOT EXISTS "metadata" JSONB`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "OrderDispute_stripeDisputeId_key" ON "OrderDispute"("stripeDisputeId")`,
];
async function main() {
  for (const s of sql) await prisma.$executeRawUnsafe(s);
  console.log('OrderDispute chargeback columns applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
