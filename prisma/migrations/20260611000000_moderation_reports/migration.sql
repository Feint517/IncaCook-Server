-- Moderation reports. Idempotent: a `Report` table + ReportReason/ReportStatus
-- enums pre-existed in some environments (created out-of-band); this brings any
-- environment up to the schema the app expects, additively.

-- Enums (create if missing) ------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReportReason') THEN
    CREATE TYPE "ReportReason" AS ENUM (
      'SPAM','INAPPROPRIATE','OFFENSIVE','FAKE','DUPLICATE','OTHER',
      'NON_FAIT_MAISON','MAUVAISE_HYGIENE'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReportStatus') THEN
    CREATE TYPE "ReportStatus" AS ENUM ('PENDING','DISMISSED','RESOLVED','REJECTED');
  END IF;
END $$;

-- Add the client-spec values to any pre-existing enums (no-op if present).
ALTER TYPE "ReportReason" ADD VALUE IF NOT EXISTS 'NON_FAIT_MAISON';
ALTER TYPE "ReportReason" ADD VALUE IF NOT EXISTS 'MAUVAISE_HYGIENE';
ALTER TYPE "ReportStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- Table --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Report" (
  "id"          TEXT NOT NULL,
  "reporterId"  TEXT NOT NULL,
  "targetType"  TEXT NOT NULL,
  "targetId"    TEXT NOT NULL,
  "reason"      "ReportReason" NOT NULL,
  "description" TEXT,
  "status"      "ReportStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedBy"  TEXT,
  "adminNote"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Report_status_createdAt_idx"
  ON "Report"("status","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Report_reporterId_targetId_reason_status_idx"
  ON "Report"("reporterId","targetId","reason","status");
