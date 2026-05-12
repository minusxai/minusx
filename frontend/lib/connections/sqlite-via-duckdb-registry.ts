import 'server-only';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

/**
 * One in-memory DuckDB instance per absolute SQLite file path, process-wide.
 * Each instance has the SQLite file attached read-only as `db` via the
 * `sqlite_scanner` extension. We route all SQLite query traffic through
 * DuckDB to avoid the better-sqlite3 sync-blocking-the-Node-event-loop
 * problem: DuckDB executes on its own worker pool, so concurrent rows /
 * datasets no longer serialise on the JS thread.
 *
 * Why a fresh in-memory instance per file (instead of attaching every
 * SQLite file to one shared instance): each connector resolves table
 * names without a catalog prefix, so each instance has its own `USE db`
 * default — keeping them isolated avoids alias collisions when the same
 * process holds many SqliteConnectors. Cost is negligible (an empty
 * DuckDB instance is <1MB).
 */
// eslint-disable-next-line no-restricted-syntax -- server-only; keyed by absolute file path (unique per org by directory layout)
const registry = new Map<string, DuckDBInstance>();
// eslint-disable-next-line no-restricted-syntax -- server-only; keyed by absolute file path (unique per org by directory layout)
const initPromises = new Map<string, Promise<DuckDBInstance>>();

async function createInstance(sqlitePath: string): Promise<DuckDBInstance> {
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  try {
    await conn.run('INSTALL sqlite');
    await conn.run('LOAD sqlite');
    const escaped = sqlitePath.replace(/'/g, "''");
    await conn.run(`ATTACH '${escaped}' AS db (TYPE SQLITE, READ_ONLY)`);
  } finally {
    conn.closeSync();
  }
  return inst;
}

export async function getOrCreateSqliteViaDuckdbInstance(sqlitePath: string): Promise<DuckDBInstance> {
  const cached = registry.get(sqlitePath);
  if (cached) return cached;
  const inFlight = initPromises.get(sqlitePath);
  if (inFlight) return inFlight;

  const p = createInstance(sqlitePath).then((inst) => {
    registry.set(sqlitePath, inst);
    initPromises.delete(sqlitePath);
    return inst;
  }).catch((err) => {
    initPromises.delete(sqlitePath);
    throw err;
  });
  initPromises.set(sqlitePath, p);
  return p;
}

export async function withSqliteViaDuckdbConnection<T>(
  sqlitePath: string,
  fn: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const inst = await getOrCreateSqliteViaDuckdbInstance(sqlitePath);
  const conn = await inst.connect();
  try {
    // USE is per-connection state; the ATTACH at instance-creation time
    // doesn't propagate the default catalog. Setting it here lets unqualified
    // table names in user SQL (e.g. `FROM users`) resolve to `db.main.users`.
    await conn.run('USE db');
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}
