-- AlterTable: postcode is optional (town-level / non-FR results carry none).
ALTER TABLE "Address" ALTER COLUMN "postalCode" DROP NOT NULL;
