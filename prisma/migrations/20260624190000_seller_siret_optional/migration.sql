-- SIRET is optional for Traiteur (required only for Sauve Ton Panier / RESTAURANT,
-- enforced in the service). Drop the NOT NULL; the @unique index stays (Postgres
-- treats NULLs as distinct, so multiple SIRET-less sellers don't collide).
ALTER TABLE "SellerBusiness" ALTER COLUMN "siret" DROP NOT NULL;
