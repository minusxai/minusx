/**
 * Secret reference helpers (File Architecture v2).
 *
 * A connection's secret credentials are NEVER stored in the connection document or shown
 * to the client / agent. Instead the config holds a `@SECRETS/…` REFERENCE string; the real
 * value lives only in the server-only `secrets` table and is resolved at query time.
 *
 * This module is intentionally NOT `server-only` — it's pure string logic, shared so the
 * client can recognise a ref (e.g. to render "•••• (saved)") without ever holding a value.
 */

export const SECRET_REF_PREFIX = '@SECRETS/';

/** A config field name that holds a credential (heuristic — over-matching is safe: an
 *  over-extracted non-secret just lives in the server-only store, never leaking). */
export function isSecretField(name: string): boolean {
  return /pass(word|wd)|secret|token|credential|service_account|private[_-]?key|api[_-]?key|access[_-]?key/i.test(name);
}

/** True if a value is a `@SECRETS/…` reference (not a raw secret). */
export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SECRET_REF_PREFIX);
}

/** Build the canonical ref path for a connection field. The ref is self-describing —
 *  resolution reads it back verbatim, so a later rename doesn't break existing refs. */
export function connectionSecretPath(connectionName: string, field: string): string {
  return `${SECRET_REF_PREFIX}connections/${connectionName}/${field}`;
}
