/**
 * Config secret specs (File Architecture v2, applied to the org config document).
 *
 * The org config (`/configs/config`) carries integration credentials (Slack bot
 * tokens, LLM provider API keys). Like connection credentials, these are NEVER
 * stored raw in the document: on save they are extracted to the server-only
 * `secrets` table and the document keeps a self-describing `@SECRETS/…` ref
 * (see `config-secrets.server.ts`). The client and the agent only ever see refs.
 *
 * This module is intentionally NOT `server-only` — it's pure object/string logic,
 * shared so the client can recognise refs/redacted values (e.g. render "•••• (saved)")
 * without ever holding a raw value.
 *
 * Ref keys are IDENTITY-based (`configSecretRefPath(mode, arrayPath, identity, field)`),
 * not index-based, so reordering an array can never attach one entry's secret to another.
 */
import { SECRET_REF_PREFIX, isSecretRef } from './secret-refs';

export interface ConfigSecretSpec {
  /** Dotted path to an ARRAY of objects carrying secrets, e.g. 'bots' or 'llm.providers'. */
  arrayPath: string;
  /** Field on each element that uniquely names it — used to build the ref key. */
  identityField: string;
  /** Fields on each element that hold raw credentials. */
  secretFields: string[];
}

/** Every secret-bearing location in the org config document. */
export const CONFIG_SECRET_SPECS: ConfigSecretSpec[] = [
  { arrayPath: 'bots', identityField: 'name', secretFields: ['bot_token', 'signing_secret'] },
  { arrayPath: 'llm.providers', identityField: 'name', secretFields: ['apiKey'] },
];

/**
 * Placeholder shown in place of a LEGACY raw secret on read (docs written before
 * extraction existed). A round-tripped placeholder is restored from the stored
 * document on save (`restoreRedactedConfigSecrets`) — never persisted.
 */
export const REDACTED_SECRET = '••••••••';

export function isRedactedSecret(value: unknown): value is string {
  return value === REDACTED_SECRET;
}

/** Canonical ref key for a config secret. Self-describing; resolution reads it verbatim. */
export function configSecretRefPath(mode: string, arrayPath: string, identity: string, field: string): string {
  return `${SECRET_REF_PREFIX}config/${mode}/${arrayPath}/${identity}/${field}`;
}

/** Resolve a dotted arrayPath (e.g. 'llm.providers') to the array it names, or null. */
function secretArrayAt(root: unknown, arrayPath: string): Record<string, unknown>[] | null {
  let node: unknown = root;
  for (const seg of arrayPath.split('.')) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[seg];
  }
  return Array.isArray(node) ? (node as Record<string, unknown>[]) : null;
}

/** A raw credential: a non-empty string that is neither a ref nor the placeholder. */
function isRawSecretValue(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !isSecretRef(value) && !isRedactedSecret(value);
}

/**
 * Visit every registered secret field on a (cloned) config and rewrite it.
 * The transform returns the new value, or `undefined` to delete the field.
 */
function mapConfigSecrets<T>(
  config: T,
  transform: (spec: ConfigSecretSpec, element: Record<string, unknown>, field: string, value: unknown) => unknown,
): T {
  if (!config || typeof config !== 'object') return config;
  const out = structuredClone(config);
  for (const spec of CONFIG_SECRET_SPECS) {
    const arr = secretArrayAt(out, spec.arrayPath);
    if (!arr) continue;
    for (const element of arr) {
      if (!element || typeof element !== 'object') continue;
      for (const field of spec.secretFields) {
        if (!(field in element)) continue;
        const next = transform(spec, element, field, element[field]);
        if (next === undefined) delete element[field];
        else element[field] = next;
      }
    }
  }
  return out;
}

/**
 * Read-side leak guard for LEGACY documents: mask any RAW value at a registered
 * secret path with `REDACTED_SECRET`. `@SECRETS/…` refs pass through untouched
 * (they are safe to show). Non-secret fields and all keys are preserved verbatim.
 * Pure — never mutates the input.
 */
export function redactRawConfigSecrets<T>(config: T): T {
  return mapConfigSecrets(config, (_spec, _el, _field, value) =>
    isRawSecretValue(value) ? REDACTED_SECRET : value,
  );
}

/**
 * Write-side guard for round-tripped redacted placeholders: wherever `incoming`
 * has `REDACTED_SECRET` at a registered secret path, restore the value stored in
 * the CURRENT document for the SAME element (matched by `identityField`, so array
 * reorder is safe). A placeholder with no stored counterpart is dropped (deleted)
 * rather than persisted. Pure — never mutates inputs.
 */
export function restoreRedactedConfigSecrets<T>(incoming: T, stored: unknown): T {
  return mapConfigSecrets(incoming, (spec, element, field, value) => {
    if (!isRedactedSecret(value)) return value;
    const storedArr = secretArrayAt(stored, spec.arrayPath) ?? [];
    const identity = element[spec.identityField];
    const counterpart = storedArr.find(e => e && typeof e === 'object' && e[spec.identityField] === identity);
    const storedValue = counterpart?.[field];
    // Restore a real stored value (ref or legacy raw); otherwise drop the placeholder.
    return typeof storedValue === 'string' && storedValue !== '' && !isRedactedSecret(storedValue)
      ? storedValue
      : undefined;
  });
}

export { isSecretRef };
