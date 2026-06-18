import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  await prisma.$executeRawUnsafe(
    `ALTER TYPE "ConversationType" ADD VALUE IF NOT EXISTS 'SELLER_DRIVER'`,
  );
  const rows = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ConversationType' ORDER BY e.enumsortorder`,
  );
  console.log('ConversationType values:', rows.map((r) => r.enumlabel).join(', '));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
