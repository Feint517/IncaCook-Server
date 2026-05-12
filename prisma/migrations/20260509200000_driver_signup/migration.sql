-- Driver signup.
--   * New enum DriverVehicleType (BICYCLE | SCOOTER | CAR)
--   * DriverProfile: drop licenseNumber, swap vehicleType text → enum,
--     add dateOfBirth, baseAddressId FK, operatingZones, ibanEncrypted,
--     ibanHolderName, charterAccepted, punctualityCommitment, careCommitment.
--
-- Safe to apply only when DriverProfile is empty (vehicleType cast +
-- NOT NULL adds without defaults would otherwise fail).

-- ============================================================
-- 1. New enum
-- ============================================================

CREATE TYPE "DriverVehicleType" AS ENUM ('BICYCLE', 'SCOOTER', 'CAR');

-- ============================================================
-- 2. DriverProfile: drop deprecated columns
-- ============================================================

ALTER TABLE "DriverProfile" DROP COLUMN "licenseNumber";

-- ============================================================
-- 3. DriverProfile: convert vehicleType text → enum
-- ============================================================

ALTER TABLE "DriverProfile"
    ALTER COLUMN "vehicleType" TYPE "DriverVehicleType"
    USING "vehicleType"::"DriverVehicleType";

-- ============================================================
-- 4. DriverProfile: add new columns
-- ============================================================

ALTER TABLE "DriverProfile"
    ADD COLUMN "dateOfBirth"           DATE NOT NULL,
    ADD COLUMN "baseAddressId"         TEXT NOT NULL,
    ADD COLUMN "operatingZones"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "ibanEncrypted"         TEXT NOT NULL,
    ADD COLUMN "ibanHolderName"        TEXT NOT NULL,
    ADD COLUMN "charterAccepted"       BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "punctualityCommitment" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "careCommitment"        BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 5. DriverProfile: FK to Address
-- ============================================================

CREATE UNIQUE INDEX "DriverProfile_baseAddressId_key"
    ON "DriverProfile"("baseAddressId");

ALTER TABLE "DriverProfile"
    ADD CONSTRAINT "DriverProfile_baseAddressId_fkey"
    FOREIGN KEY ("baseAddressId") REFERENCES "Address"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
