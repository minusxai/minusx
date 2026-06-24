/**
 * Server-only CRUD for the `secrets` table (File Architecture v2).
 *
 * The table stores `@SECRETS/…` ref → raw value. It is NOT a `files` row, so it never
 * flows through FilesAPI / ReadFiles / markup / compress. Access ONLY through this module
 * (and its callers in *.server.ts) — never expose a value to the client or the agent.
 */
import 'server-only';
import { getModules } from '@/lib/modules/registry';

export const SecretsDB = {
  /** Resolve a `@SECRETS/…` ref to its raw value (server-only). */
  async get(path: string): Promise<string | null> {
    const db = getModules().db;
    const result = await db.exec<{ value: string }>('SELECT value FROM secrets WHERE path = $1', [path]);
    return result.rows[0]?.value ?? null;
  },

  /** Upsert a secret value at a ref path. */
  async set(path: string, value: string): Promise<void> {
    const db = getModules().db;
    await db.exec(
      `INSERT INTO secrets (path, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (path) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [path, value],
    );
  },

  /** Delete a secret (e.g. when a connection is removed). */
  async delete(path: string): Promise<void> {
    const db = getModules().db;
    await db.exec('DELETE FROM secrets WHERE path = $1', [path]);
  },
};
