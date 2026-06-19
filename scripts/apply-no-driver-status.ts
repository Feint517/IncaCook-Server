import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  // ADD VALUE cannot run inside a transaction block; executeRawUnsafe runs it standalone.
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'NO_DRIVER_AVAILABLE'`,
  );
  console.log('OrderStatus NO_DRIVER_AVAILABLE applied.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
