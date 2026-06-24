/**
 * Extract / resolve connection secrets (File Architecture v2, server-only).
 *
 * - extractConnectionSecrets: called on SAVE — moves raw credential values out of the
 *   connection config into the server-only `secrets` table, leaving a `@SECRETS/…` ref.
 *   So the connection DOCUMENT (and its markup) never contains a raw credential.
 * - resolveConnectionSecrets: called at QUERY time (server) — swaps refs back to values
 *   right before the config is handed to a connector. Values never leave the server.
 *
 * Backward compatible: a legacy raw value (no ref) passes through resolve untouched, and
 * gets extracted to a ref on the next save — no data migration needed.
 */
import 'server-only';
import { SecretsDB } from './secrets-db.server';
import { isSecretField, isSecretRef, connectionSecretPath } from './secret-refs';

type Config = Record<string, unknown>;

/** Move raw secret values to the store; return a config whose secret fields are refs. */
export async function extractConnectionSecrets(connectionName: string, config: Config): Promise<Config> {
  const out: Config = { ...config };
  for (const [key, value] of Object.entries(config)) {
    // Only extract raw, non-empty string secrets — already-a-ref or non-secret stays put.
    if (isSecretField(key) && typeof value === 'string' && value !== '' && !isSecretRef(value)) {
      const path = connectionSecretPath(connectionName, key);
      await SecretsDB.set(path, value);
      out[key] = path;
    }
  }
  return out;
}

/**
 * Carry forward existing `@SECRETS/…` refs for any secret field the incoming config omits
 * or blanks — `getSafeConfig` strips secrets on load, so an UNCHANGED credential arrives
 * absent/"". Run this before extract so editing a non-secret field doesn't wipe the secret.
 */
export function mergeExistingSecretRefs(newConfig: Config, existingConfig: Config): Config {
  const out: Config = { ...newConfig };
  for (const [key, value] of Object.entries(existingConfig)) {
    if (isSecretRef(value) && (out[key] === undefined || out[key] === '')) out[key] = value;
  }
  return out;
}

/** Resolve any `@SECRETS/…` refs in a config to their raw values (server-only). */
export async function resolveConnectionSecrets(config: Config): Promise<Config> {
  const out: Config = { ...config };
  for (const [key, value] of Object.entries(config)) {
    if (isSecretRef(value)) {
      const resolved = await SecretsDB.get(value);
      if (resolved !== null) out[key] = resolved;
    }
  }
  return out;
}
