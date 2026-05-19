// Worker side of `BenchmarkSqliteConnector`. Holds one `better-sqlite3`
// `Database` instance and serves queries via worker_threads messages —
// so the main JS thread is never blocked on `stmt.all()` and parallel
// sub-agents can actually run their sqlite work in parallel.
//
// Plain `.cjs` because the frontend package is ESM (`"type": "module"`)
// but better-sqlite3 only exports CJS. Avoiding the loader gymnastics.

const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');

if (!parentPort) throw new Error('sqlite-worker must be run inside a worker_thread');

const { dbPath } = workerData;
if (typeof dbPath !== 'string') {
  parentPort.postMessage({ type: 'fatal', error: 'workerData.dbPath missing or not a string' });
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch (err) {
  parentPort.postMessage({ type: 'fatal', error: err && err.message ? err.message : String(err) });
  process.exit(1);
}

// ── helpers (mirror sqlite-native-connector.ts) ────────────────────────────

function quoteIdent(id) {
  return `"${String(id).replace(/"/g, '""')}"`;
}

function makeJsonSafe(rows) {
  return JSON.parse(JSON.stringify(rows, (_k, v) => {
    if (typeof v === 'bigint') {
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
      return v <= maxSafe && v >= minSafe ? Number(v) : v.toString();
    }
    if (v instanceof Uint8Array) return Buffer.from(v).toString('base64');
    return v;
  }));
}

function readColumns(table) {
  const rows = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
  return rows.map((c) => ({
    name: c.name,
    type: ((c.type || '') || 'NUMERIC').toUpperCase(),
  }));
}

function readIndexes(table) {
  const idxList = db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all();
  const sorted = [...idxList].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return sorted.map((ix) => {
    const cols = db.prepare(`PRAGMA index_info(${quoteIdent(ix.name)})`).all();
    return {
      name: ix.name,
      columns: cols.map((c) => c.name).filter((n) => typeof n === 'string'),
      unique: ix.unique === 1,
    };
  });
}

// ── request handlers ─────────────────────────────────────────────────────

function handleQuery({ sql, params }) {
  const stmt = db.prepare(sql);
  const rows = params ? stmt.all(params) : stmt.all();
  const cols = stmt.columns();
  return {
    columns: cols.map((c) => c.name),
    types: cols.map((c) => (c.type ?? '').toUpperCase()),
    rows: makeJsonSafe(rows),
  };
}

function handleGetSchema() {
  const tableNames = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);
  const tables = tableNames.map((table) => ({
    table,
    columns: readColumns(table),
    indexes: readIndexes(table),
  }));
  return [{ schema: 'main', tables }];
}

function handlePing() {
  db.prepare('SELECT 1').get();
  return true;
}

// ── message loop ─────────────────────────────────────────────────────────

parentPort.on('message', (msg) => {
  if (msg && msg.type === 'close') {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  }
  if (!msg || typeof msg.id !== 'number') return;
  try {
    let value;
    switch (msg.type) {
      case 'query':       value = handleQuery(msg); break;
      case 'getSchema':   value = handleGetSchema(); break;
      case 'ping':        value = handlePing(); break;
      default:
        parentPort.postMessage({ id: msg.id, ok: false, error: `unknown message type: ${msg.type}` });
        return;
    }
    parentPort.postMessage({ id: msg.id, ok: true, value });
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: err && err.message ? err.message : String(err) });
  }
});

parentPort.postMessage({ type: 'ready' });
