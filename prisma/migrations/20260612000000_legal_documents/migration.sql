-- Admin-editable CGU/CGV legal documents. Additive; reuses the existing
-- "CharterKind" enum (only CGU/CGV are managed by this feature). The active row
-- per kind is the canonical published text shown in-app and recorded on
-- publish/purchase acceptance. Idempotent so it is safe to (re)apply.

CREATE TABLE IF NOT EXISTS "LegalDocument" (
  "id"          TEXT NOT NULL,
  "kind"        "CharterKind" NOT NULL,
  "version"     TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "content"     TEXT NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "createdBy"   TEXT,
  "updatedBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- One document per (kind, version); one active row per kind is enforced in the
-- service (publish deactivates the previous active version transactionally).
CREATE UNIQUE INDEX IF NOT EXISTS "LegalDocument_kind_version_key"
  ON "LegalDocument"("kind","version");
CREATE INDEX IF NOT EXISTS "LegalDocument_kind_isActive_idx"
  ON "LegalDocument"("kind","isActive");
