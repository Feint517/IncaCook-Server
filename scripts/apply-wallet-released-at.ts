import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "WalletEntry" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3)`,
  );
  console.log('WalletEntry.releasedAt applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
