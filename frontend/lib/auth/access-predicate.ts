/**
 * Access V2 — the single, pure evaluation engine for "can this principal touch
 * this file". `checkAccess` is the in-memory evaluator; in M1b the SAME
 * `AccessPredicate` structure compiles to a SQL `WHERE` fragment, so the two
 * enforcement paths can never diverge.
 *
 * Pure: no DB, no `server-only`, no `fs`. The resolver (`access-resolver.ts`)
 * turns an `EffectiveUser` (+ config overrides, and later group memberships)
 * into an `AccessPredicate`; this file only interprets it.
 *
 * M1a reproduces today's read/access decision EXACTLY (`canAccessFile`,
 * `canViewFileInUI`, and the embedded-reference variant) — verified by the
 * differential characterization battery in `__tests__/access-predicate.test.ts`.
 */
import type { FileType } from '@/lib/types';
import type { Mode } from '@/lib/mode/mode-types';
import { isUnderSystemFolder } from '@/lib/mode/path-resolver';

export type TypeSet = '*' | FileType[];

/**
 * Which checks apply — mirrors today's two reference variants plus UI listing:
 * - `access`   — full check (type + mode + path). `canAccessFile`. Folder
 *                children, direct loads, API access.
 * - `embedded` — embedded assets (a dashboard's questions): type + mode only,
 *                no path scope — they travel with the container you can open.
 * - `ui`       — `access` plus the `viewTypes` gate. `canViewFileInUI`.
 *                Search results, folder-browser listings.
 */
export type AccessVariant = 'access' | 'embedded' | 'ui';

/** One resolved absolute path prefix that grants access (OR'd across scopes). */
export interface AccessScope {
  /** Resolved absolute path prefix, e.g. `/org/sales`. */
  path: string;
  /** Home folder only: exclude system subfolders (re-granted via explicit system scopes). */
  excludeSystem?: boolean;
  /** Conversation folder: raw `startsWith`, no `/` boundary — reproduces legacy behavior. */
  matchRaw?: boolean;
}

/**
 * A principal's resolved access, as a self-contained snapshot. Type sets come
 * from the role rules (+ config overrides); scopes are resolved absolute paths.
 * Admins bypass mode-scoped path checks (but still obey mode isolation + type).
 */
export interface AccessPredicate {
  admin: boolean;
  mode: Mode;
  /** `canAccessFileType` basis. */
  allowedTypes: TypeSet;
  /** `canViewFileType` basis (UI variant only). */
  viewTypes: TypeSet;
  /** Non-admin path grants (home + database + own conversations + runs). */
  scopes: AccessScope[];
  /** Non-admin resolved home folder — for the ancestor-context rule; null if none/admin. */
  homeFolder: string | null;
}

function typeAllowed(type: FileType, set: TypeSet): boolean {
  return set === '*' || set.includes(type);
}

function scopeMatches(filePath: string, s: AccessScope, mode: Mode): boolean {
  const hit = s.matchRaw
    ? filePath.startsWith(s.path)
    : filePath === s.path || filePath.startsWith(s.path + '/');
  if (!hit) return false;
  if (s.excludeSystem && isUnderSystemFolder(filePath, mode)) return false;
  return true;
}

/** A context file whose directory is an ancestor of the home folder (hierarchical schema filtering). */
function isAncestorContext(type: FileType, path: string, homeFolder: string | null): boolean {
  if (type !== 'context' || !homeFolder) return false;
  const dir = path.substring(0, path.lastIndexOf('/'));
  return homeFolder === dir || homeFolder.startsWith(dir + '/');
}

/**
 * Evaluate a principal's access to one file. Pure and total. Reproduces
 * `canAccessFile` (`access`), `canViewFileInUI` (`ui`), and the embedded-asset
 * reference rule (`embedded`) exactly.
 */
export function checkAccess(
  file: { type: FileType; path: string },
  p: AccessPredicate,
  variant: AccessVariant = 'access',
): boolean {
  // Type gate — applies to every principal (admin's allowedTypes is '*').
  if (!typeAllowed(file.type, p.allowedTypes)) return false;
  if (variant === 'ui' && !typeAllowed(file.type, p.viewTypes)) return false;

  // Mode isolation — applies to every principal, including admins.
  const modePrefix = `/${p.mode}`;
  if (!(file.path === modePrefix || file.path.startsWith(modePrefix + '/'))) return false;

  if (p.admin) return true;

  // Embedded assets skip path scoping (they travel with their container).
  if (variant === 'embedded') return true;

  // Non-admin path grants (OR), then the ancestor-context special case.
  for (const s of p.scopes) {
    if (scopeMatches(file.path, s, p.mode)) return true;
  }
  return isAncestorContext(file.type, file.path, p.homeFolder);
}
