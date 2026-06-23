import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "WalletEntryType" ADD VALUE IF NOT EXISTS 'DRIVER_DEBT'`,
  );
  console.log('WalletEntryType DRIVER_DEBT applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
