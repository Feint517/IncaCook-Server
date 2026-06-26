import { PrismaClient } from '@prisma/client';
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });
async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "SellerBusiness" ALTER COLUMN "siret" DROP NOT NULL`);
  console.log('SellerBusiness.siret is now nullable.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
