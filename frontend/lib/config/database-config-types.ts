/**
 * In-app database connection configuration — the `databases` section of the
 * org config document (`/configs/config`). Database connections are
 * INFRASTRUCTURE (credentials + endpoints), so they live in config and are
 * managed from Settings → Databases (admin-only), exactly like the `llm`
 * section — NOT as files in `/database`. Static data (CSV / Sheets) is the
 * opposite: ordinary `dataset` files in folders (see lib/types/datasets.ts).
 *
 * Pure types + pure helpers only — imported by both server resolution and the
 * settings UI. Secret config fields are `@SECRETS/…` refs at rest (see
 * lib/secrets/config-secret-specs.ts); the client never sees a raw credential.
 *
 * MIGRATION INVARIANT: entry `name`s are byte-identical to the old
 * `/database/<name>` file names — contexts, saved questions, Views and the
 * query cache all key off the connection name and must keep resolving.
 */

/** One configured database connection. */
export interface DatabaseConfigEntry {
  /** Unique per mode; the stable handle everything keys off. */
  name: string;
  /** Connector type: 'postgresql' | 'bigquery' | 'athena' | 'clickhouse' | … */
  type: string;
  /** Connector config; secret fields are `@SECRETS/…` refs at rest. */
  config: Record<string, unknown>;
}

/** The `databases` config section. */
export interface DatabasesConfig {
  connections: DatabaseConfigEntry[];
}

/** Validate the `databases` section; returns the failure reason or null. */
export function validateDatabasesConfig(databases: unknown): string | null {
  if (typeof databases !== 'object' || databases === null) return 'databases must be an object';
  const cfg = databases as Record<string, unknown>;
  if (!Array.isArray(cfg.connections)) return 'databases.connections must be an array';
  const seen = new Set<string>();
  for (const entry of cfg.connections) {
    if (typeof entry !== 'object' || entry === null) return 'each connection must be an object';
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== 'string' || !e.name.trim()) return 'each connection needs a non-empty name';
    if (typeof e.type !== 'string' || !e.type.trim()) return `connection '${e.name}' needs a type`;
    if (typeof e.config !== 'object' || e.config === null) return `connection '${e.name}' needs a config object`;
    if (seen.has(e.name)) return `duplicate connection name '${e.name}'`;
    seen.add(e.name);
  }
  return null;
}
