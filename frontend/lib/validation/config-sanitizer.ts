import type { OrgConfig } from '@/lib/branding/whitelabel';
import {
  validateOrgConfig,
  orgConfigValidationError,
  VALID_FILE_TYPES,
  VALID_VIZ_TYPES,
  VALID_ACCESS_FIELDS,
} from '@/lib/validation/config-validators';
import { immutableSet } from '@/lib/utils/immutable-collections';

/**
 * Result of sanitizing a stored/incoming org config.
 * - `config`  — the healed config (a `Partial<OrgConfig>`), safe to merge over defaults.
 * - `warnings`— human-readable notes about what was healed or dropped (surfaced in the UI / server logs).
 * - `errors`  — residual, non-healable validation failures. The write path rejects when this is non-empty.
 */
export interface SanitizeResult {
  config: Partial<OrgConfig>;
  warnings: string[];
  errors: string[];
}

export interface SanitizeOptions {
  /**
   * When true (READ path): a section that is still invalid after healing is
   * DROPPED (falls back to its default via `mergeConfig`) and recorded as a
   * warning — the whole document is never discarded, `setupWizard` never reset.
   * When false (WRITE path): invalid sections are left in `config` and their
   * reason recorded in `errors`, so the caller can reject the save.
   */
  dropInvalidSections?: boolean;
}

/**
 * Make an arbitrary stored/incoming org config coherent.
 *
 * HEAL (self-inflicted schema drift — inert values we ourselves retired):
 *   - file types removed from `FILE_TYPE_METADATA` (e.g. `conversation`) are
 *     stripped from `accessRules.*` and `supportedFileTypes`;
 *   - visualization types no longer supported are stripped from `allowedVizTypes`;
 *   - the retired `llm.assignments` key is dropped (its `providers` are kept, so a
 *     sole bring-your-own-key provider still resolves as "Auto").
 *
 * VALIDATE (per section, independently): each healed section is validated on its
 * own. One bad section never invalidates the rest — the core defect this fixes.
 */
/** Sections `validateOrgConfig` actually inspects — the granularity at which a
 *  bad section is isolated. Keep in sync with `validateOrgConfig`. */
const VALIDATED_SECTIONS = [
  'branding', 'links', 'messaging', 'accessRules',
  'allowedVizTypes', 'supportedFileTypes', 'setupWizard', 'llm',
] as const;

const VIZ_TYPE_SET = immutableSet(VALID_VIZ_TYPES as readonly string[]);

/** Filter a file-type array down to types we still support. `'*'` and non-arrays
 *  pass through untouched (validated later). Removed members are recorded. */
function healFileTypeArray(value: unknown, removed: Set<string>): unknown {
  if (!Array.isArray(value)) return value;
  return value.filter((item) => {
    if (typeof item === 'string' && !VALID_FILE_TYPES.has(item)) {
      removed.add(item);
      return false;
    }
    return true;
  });
}

/** The specific reason a section is invalid — detailed for `llm`, named otherwise. */
function sectionReason(key: string, value: unknown): string {
  if (key === 'llm') {
    const reason = orgConfigValidationError({ llm: value } as unknown);
    if (reason) return reason;
  }
  return `Invalid \`${key}\` section`;
}

export function sanitizeOrgConfig(raw: unknown, opts: SanitizeOptions = {}): SanitizeResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { config: {}, warnings, errors: ['Config must be a JSON object'] };
  }

  // Work on a deep copy — never mutate the caller's stored/incoming object.
  const healed = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

  // ── HEAL: strip inert schema-drift we ourselves retired ────────────────────
  const removedFileTypes = new Set<string>();

  const accessRules = healed.accessRules;
  if (accessRules && typeof accessRules === 'object') {
    for (const override of Object.values(accessRules as Record<string, unknown>)) {
      if (!override || typeof override !== 'object') continue;
      const o = override as Record<string, unknown>;
      for (const field of VALID_ACCESS_FIELDS) {
        if (field in o) o[field] = healFileTypeArray(o[field], removedFileTypes);
      }
    }
  }

  if (Array.isArray(healed.supportedFileTypes)) {
    healed.supportedFileTypes = healFileTypeArray(healed.supportedFileTypes, removedFileTypes);
  }

  if (removedFileTypes.size > 0) {
    warnings.push(`Removed file type(s) no longer supported: ${[...removedFileTypes].join(', ')}.`);
  }

  if (Array.isArray(healed.allowedVizTypes)) {
    const removedViz = new Set<string>();
    healed.allowedVizTypes = healed.allowedVizTypes.filter((t) => {
      if (typeof t === 'string' && !VIZ_TYPE_SET.has(t)) {
        removedViz.add(t);
        return false;
      }
      return true;
    });
    if (removedViz.size > 0) {
      warnings.push(`Removed visualization type(s) no longer supported: ${[...removedViz].join(', ')}.`);
    }
  }

  const llm = healed.llm;
  if (llm && typeof llm === 'object' && 'assignments' in (llm as Record<string, unknown>)) {
    delete (llm as Record<string, unknown>).assignments;
    warnings.push('Removed the retired `llm.assignments` setting — its provider was kept, so a single connected provider still resolves. Configure model grades in Settings → Models.');
  }

  // ── VALIDATE: each section independently; one bad section never sinks the rest ─
  for (const key of VALIDATED_SECTIONS) {
    if (!(key in healed)) continue;
    if (validateOrgConfig({ [key]: healed[key] })) continue;

    const reason = sectionReason(key, healed[key]);
    if (opts.dropInvalidSections) {
      delete healed[key];
      warnings.push(`Ignored invalid \`${key}\` section (using default): ${reason}.`);
    } else {
      errors.push(reason);
    }
  }

  return { config: healed as Partial<OrgConfig>, warnings, errors };
}
