import { CharterKind } from '@prisma/client';

/**
 * Currently-active charter versions. The Flutter app fetches this via
 * `GET /v1/charters/active` before recording acceptance via
 * `POST /v1/users/me/charters`. Bumping a version here causes existing
 * users to be re-prompted on next sign-in (UserCharter rows are keyed on
 * version, so an older accepted version doesn't count as the current).
 *
 * Live in code rather than a DB row because version bumps are intentional
 * code changes — the audit trail is in git history. Move to a DB row only
 * when an ops process needs to bump versions without a deploy.
 */
export const ACTIVE_CHARTER_VERSIONS: Readonly<Record<CharterKind, string>> = {
  [CharterKind.CGU]: 'v1.0',
  [CharterKind.CGV]: 'v1.0',
  [CharterKind.HYGIENE]: 'v1.0',
  [CharterKind.FAIT_MAISON]: 'v1.0',
  [CharterKind.PUNCTUALITY]: 'v1.0',
  [CharterKind.CARE]: 'v1.0',
};
