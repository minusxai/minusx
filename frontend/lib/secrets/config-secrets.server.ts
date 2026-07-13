/**
 * Extract / resolve org-config secrets (server-only) — the config-document
 * counterpart of `connection-secrets.server.ts`.
 *
 * - extractConfigSecrets: called on every config WRITE path (`saveConfig`,
 *   `saveRawConfig`, `FilesAPI.saveFile` for type 'config') — moves raw
 *   credential values out of the config content into the server-only `secrets`
 *   table, leaving a `@SECRETS/…` ref. The persisted DOCUMENT never contains a
 *   raw credential, so every read path (files API, ReadFiles tool, /api/configs,
 *   SSR hydration, exports) is safe by construction.
 * - resolveConfigSecrets: called at USE time (server only — Slack API calls,
 *   LLM calls) — deep-walks any value and swaps refs back to raw values right
 *   before use. Values never leave the server.
 *
 * Backward compatible: a legacy raw value (no ref) passes through resolve
 * untouched and gets extracted to a ref on the next save. Read paths mask such
 * legacy raw values via `redactRawConfigSecrets` (see `config-secret-specs.ts`).
 */
import 'server-only';
import { SecretsDB } from './secrets-db.server';
import { isSecretRef } from './secret-refs';
import {
  CONFIG_SECRET_SPECS,
  configSecretRefPath,
  isRedactedSecret,
} from './config-secret-specs';
import { VALID_MODES, DEFAULT_MODE, type Mode } from '@/lib/mode/mode-types';

/** Mode of a physical file path ('/tutorial/…' → 'tutorial'); DEFAULT_MODE if unrecognised. */
export function modeFromPhysicalPath(path: string): Mode {
  const seg = path.split('/')[1];
  return (VALID_MODES as readonly string[]).includes(seg) ? (seg as Mode) : DEFAULT_MODE;
}

/**
 * Move raw secret values at registered config secret paths into the secrets
 * store; return content whose secret fields are `@SECRETS/…` refs.
 * Already-a-ref values and redacted placeholders are left untouched
 * (placeholders should be restored via `restoreRedactedConfigSecrets` BEFORE
 * calling this). Pure with respect to the input (returns a new object).
 */
export async function extractConfigSecrets<T>(mode: Mode, content: T): Promise<T> {
  if (!content || typeof content !== 'object') return content;
  const out = structuredClone(content) as Record<string, unknown>;
  for (const spec of CONFIG_SECRET_SPECS) {
    let node: unknown = out;
    for (const seg of spec.arrayPath.split('.')) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[seg] : undefined;
    }
    if (!Array.isArray(node)) continue;
    for (const [index, element] of (node as Record<string, unknown>[]).entries()) {
      if (!element || typeof element !== 'object') continue;
      // Identity-based ref key (reorder-safe); positional fallback for unnamed elements.
      const identityRaw = element[spec.identityField];
      const identity = typeof identityRaw === 'string' && identityRaw !== '' ? identityRaw : `at-${index}`;
      for (const field of spec.secretFields) {
        const value = element[field];
        if (typeof value !== 'string' || value === '' || isSecretRef(value) || isRedactedSecret(value)) continue;
        const refPath = configSecretRefPath(mode, spec.arrayPath, identity, field);
        await SecretsDB.set(refPath, value);
        element[field] = refPath;
      }
    }
  }
  return out as T;
}

/**
 * Deep-resolve any `@SECRETS/…` ref found anywhere in `value` (objects, arrays,
 * strings) to its raw secret. Unknown refs resolve to themselves (left as-is).
 * Usable on a whole config, a single bot entry, or a provider entry.
 */
export async function resolveConfigSecrets<T>(value: T): Promise<T> {
  if (isSecretRef(value)) {
    const resolved = await SecretsDB.get(value);
    return (resolved ?? value) as T;
  }
  if (Array.isArray(value)) {
    return (await Promise.all(value.map(v => resolveConfigSecrets(v)))) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await resolveConfigSecrets(v);
    }
    return out as T;
  }
  return value;
}
