import { CharterKind } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { ACTIVE_CHARTER_VERSIONS } from '../charters/charters.constants';

/** The two legal kinds whose active version is admin-managed via LegalDocument.
 *  (Prisma exports CharterKind as a value+type, so member access must go via
 *  `typeof` to read the literal type.) */
type LegalKind = typeof CharterKind.CGU | typeof CharterKind.CGV;
export type TermsVersions = Record<LegalKind, string>;

/**
 * Resolves the currently-active CGU + CGV version strings from the
 * admin-managed [LegalDocument] table, falling back to the code-level
 * [ACTIVE_CHARTER_VERSIONS] when no document is published (or the table is not
 * present yet). Shared by the acceptance recorder and the documents service so
 * publish/purchase always stamps the version the admin actually published.
 */
export async function resolveActiveTermsVersions(prisma: PrismaService): Promise<TermsVersions> {
  const versions: TermsVersions = {
    [CharterKind.CGU]: ACTIVE_CHARTER_VERSIONS[CharterKind.CGU],
    [CharterKind.CGV]: ACTIVE_CHARTER_VERSIONS[CharterKind.CGV],
  };
  try {
    const active = await prisma.db.legalDocument.findMany({
      where: { kind: { in: [CharterKind.CGU, CharterKind.CGV] }, isActive: true },
      select: { kind: true, version: true },
    });
    for (const doc of active) {
      if (doc.kind === CharterKind.CGU || doc.kind === CharterKind.CGV) {
        versions[doc.kind] = doc.version;
      }
    }
  } catch {
    // Best-effort: if the table is missing, fall back to the code constant.
  }
  return versions;
}
