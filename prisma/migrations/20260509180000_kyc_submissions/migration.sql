-- KYC submissions, phase 2 of the seller signup flow.
--
-- Adds:
--   * IdDocumentType enum
--   * KycSubmission table (shared shape for sellers + drivers)
--   * Storage RLS policies on the `kyc/` bucket: owner-only read/write,
--     plus admin/moderator read.
--
-- The `kyc` bucket itself must exist in storage.buckets before file uploads
-- will work. Create it via the Supabase dashboard (Storage → New bucket,
-- name "kyc", private). The RLS policies below attach to storage.objects
-- and become effective once the bucket exists.

-- ============================================================
-- 1. Enum
-- ============================================================

CREATE TYPE "IdDocumentType" AS ENUM ('CARTE_IDENTITE', 'PASSEPORT', 'TITRE_SEJOUR');

-- ============================================================
-- 2. KycSubmission table
-- ============================================================

CREATE TABLE "KycSubmission" (
    "id"              TEXT             NOT NULL,
    "userId"          TEXT             NOT NULL,
    "idDocumentType"  "IdDocumentType" NOT NULL,
    "idFrontUrl"      TEXT             NOT NULL,
    "idBackUrl"       TEXT,
    "selfieUrl"       TEXT             NOT NULL,
    "drivingLicenseUrl" TEXT,
    "carteGriseUrl"   TEXT,
    "insuranceUrl"    TEXT,
    "status"          "KycStatus"      NOT NULL DEFAULT 'PENDING',
    "reviewerId"      TEXT,
    "reviewedAt"      TIMESTAMP(3),
    "rejectionReason" TEXT,
    "submittedAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KycSubmission_userId_submittedAt_idx"
    ON "KycSubmission"("userId", "submittedAt" DESC);

CREATE INDEX "KycSubmission_status_idx"
    ON "KycSubmission"("status");

ALTER TABLE "KycSubmission"
    ADD CONSTRAINT "KycSubmission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KycSubmission"
    ADD CONSTRAINT "KycSubmission_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 3. Storage RLS for the kyc/ bucket
--
-- Path convention: kyc/<supabase_user_id>/<filename>
-- The first folder segment is the auth.uid() of the owner. RLS uses that
-- to gate read/write to the owner only, plus a separate policy for
-- admin/moderator reviewers.
-- ============================================================

DROP POLICY IF EXISTS "kyc_owner_select" ON storage.objects;
DROP POLICY IF EXISTS "kyc_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "kyc_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "kyc_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "kyc_reviewer_select" ON storage.objects;

CREATE POLICY "kyc_owner_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'kyc'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "kyc_owner_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'kyc'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "kyc_owner_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'kyc'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "kyc_owner_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'kyc'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "kyc_reviewer_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'kyc'
        AND EXISTS (
            SELECT 1 FROM "User"
            WHERE "supabaseId" = auth.uid()::text
              AND "role" IN ('ADMIN', 'MODERATOR')
              AND "deletedAt" IS NULL
        )
    );
