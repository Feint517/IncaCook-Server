import { CharterKind } from '@prisma/client';

import { PrismaService } from '@infrastructure/database/prisma.service';

import { ACTIVE_CHARTER_VERSIONS } from './charters.constants';

/**
 * Records the user's acceptance of the currently-active CGU + CGV versions as
 * durable [UserCharter] rows. Idempotent on the `(userId, charter, version)`
 * PK, so re-accepting the same version (e.g. already agreed at signup) is a
 * no-op; a version bump appends a fresh row.
 *
 * Used where the client spec requires an explicit CGU/CGV checkbox at the
 * point of action — dish publication (seller) and order purchase (buyer).
 *
 * Best-effort: a failed audit write must NEVER break the underlying
 * publish/purchase, so every error is swallowed.
 *
 * NOTE: UserCharter has no per-action `context` column, so this captures
 * version-level acceptance, not which action (LISTING_CREATE vs ORDER_CREATE)
 * triggered it. Adding context would require a schema change.
 */
export async function recordTermsAcceptance(prisma: PrismaService, userId: string): Promise<void> {
  try {
    await Promise.all(
      [CharterKind.CGU, CharterKind.CGV].map((charter) =>
        prisma.db.userCharter.upsert({
          where: {
            userId_charter_version: {
              userId,
              charter,
              version: ACTIVE_CHARTER_VERSIONS[charter],
            },
          },
          create: { userId, charter, version: ACTIVE_CHARTER_VERSIONS[charter] },
          update: {},
        }),
      ),
    );
  } catch {
    // best-effort audit — never block the publish/purchase
  }
}
