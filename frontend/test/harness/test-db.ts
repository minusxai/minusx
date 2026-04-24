/**
 * Test database lifecycle management
 *
 * Each setupTestDb() call gets its own PostgreSQL schema (derived from dbPath).
 * Suites with the same dbPath share a schema; different dbPaths get isolated tables.
 *
 * Import is done as a single adapter.exec() call — no JS event-loop yields during
 * DELETE+INSERT — so async listeners from previous tests cannot interleave and cause
 * duplicate-key errors.
 */

import path from 'path';
import {
  setupTestStore
} from '@/store/__tests__/test-utils';
import { buildInitData, InitData } from '@/lib/database/import-export';
import { POSTGRES_SCHEMA, splitSQLStatements } from '@/lib/database/postgres-schema';
import { LATEST_SCHEMA_VERSION } from '@/lib/database/constants';
import { getModules } from '@/lib/modules/registry';

export interface TestDbHarness {
  getStore: () => ReturnType<typeof setupTestStore>;
}

export interface TestDbOptions {
  /** Custom initialization function called after base init */
  customInit?: (dbPath: string) => Promise<void>;
  /** Automatically add test connection (id: 'test_connection') */
  withTestConnection?: boolean;
  withTutorialFiles?: boolean;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Derive a valid PostgreSQL identifier from a db file path. */
function schemaFromPath(dbPath: string): string {
  return path.basename(dbPath, '.db').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || 'test_default';
}

/** Minimal SQL literal escaping — safe for all string values including JSON. */
function sqlLit(v: any): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Build a single SQL string for the entire import: SET search_path + DELETE + INSERT.
 * Executed as one adapter.exec() call so no async listener can interleave.
 */
function buildImportSQL(
  initData: InitData,
  schemaName: string,
  testConnectionJson?: string,
): string {
  const users = initData.users ?? [];
  const documents = initData.documents ?? [];

  const parts: string[] = [
    `SET search_path TO ${schemaName}`,
    `DELETE FROM file_events`,
    `DELETE FROM llm_call_events`,
    `DELETE FROM query_execution_events`,
    `DELETE FROM job_runs`,
    `DELETE FROM files`,
    `DELETE FROM users`,
  ];

  for (const u of users) {
    parts.push(
      `INSERT INTO users (id,email,name,password_hash,phone,state,home_folder,role,created_at,updated_at) VALUES (${[
        u.id, u.email, u.name, u.password_hash ?? null, u.phone ?? null,
        u.state ?? null, u.home_folder ?? '', u.role ?? 'viewer',
        u.created_at, u.updated_at,
      ].map(sqlLit).join(',')})`,
    );
  }

  for (const doc of documents) {
    const content = JSON.stringify((doc as any).content ?? {});
    const refs = JSON.stringify((doc as any).references ?? []);
    parts.push(
      `INSERT INTO files (id,name,path,type,content,file_references,version,last_edit_id,created_at,updated_at) VALUES (${[
        (doc as any).id, doc.name, doc.path, doc.type,
        content, refs,
        (doc as any).version ?? 1, (doc as any).last_edit_id ?? null,
        doc.created_at, doc.updated_at,
      ].map(sqlLit).join(',')})`,
    );
  }

  parts.push(`DELETE FROM configs WHERE key IN ('data_version','schema_version')`);
  parts.push(`INSERT INTO configs (key,value) VALUES ('data_version',${sqlLit(String(initData.version))})`);
  parts.push(`INSERT INTO configs (key,value) VALUES ('schema_version',${sqlLit(String(LATEST_SCHEMA_VERSION))})`);

  if (testConnectionJson) {
    // Compute next_id inline — safe because we just finished inserting all docs above
    // and the MAX id is deterministic. Use a CTE to avoid a separate query.
    parts.push(
      `INSERT INTO files (id,name,path,type,content,file_references,created_at,updated_at)
       SELECT COALESCE(MAX(id),0)+1, 'default_db', '/org/connections/test_connection',
              'connection', ${sqlLit(testConnectionJson)}, '[]',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       FROM files
       WHERE NOT EXISTS (SELECT 1 FROM files WHERE path='/org/connections/test_connection')`,
    );
  }

  return parts.join(';\n') + ';';
}

// Tracks which schemas have been initialised on the current adapter instance.
// Cleared by resetDB() when the adapter is replaced with a fresh one.
const initializedSchemas = new Set<string>();

/**
 * Reset the adapter singleton and clear schema-init tracking.
 * Call this in beforeEach when you need a completely fresh in-memory DB.
 */
export async function resetDB(): Promise<void> {
  await getModules().db.reset?.();
  initializedSchemas.clear();
}

/**
 * Run schema DDL for `schemaName` if it has not yet been initialised on the current adapter.
 * State is tracked in `initializedSchemas`; resetDB() clears it when the adapter is replaced.
 */
async function ensureSchema(schemaName: string): Promise<void> {
  const db = getModules().db;
  if (initializedSchemas.has(schemaName)) {
    await db.exec(`SET search_path TO ${schemaName}`);
    return;
  }

  await db.exec(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
  await db.exec(`SET search_path TO ${schemaName}`);

  for (const stmt of splitSQLStatements(POSTGRES_SCHEMA)) {
    if (/^\s*CREATE\s+SCHEMA\b/i.test(stmt)) continue;
    try {
      await db.exec(stmt);
    } catch (e: any) {
      if (e?.code !== '23505' && e?.code !== '42710') throw e;
    }
  }

  initializedSchemas.add(schemaName);
}

// ── public helpers ────────────────────────────────────────────────────────────

export async function addTestConnection(_dbPath: string) {
  // This is still available for callers that need it outside setupTestDb.
  // setupTestDb itself inlines the connection insert into the atomic exec.
  const db = getModules().db;
  const now = new Date().toISOString();

  const existing = await db.exec<{ id: number }>(
    `SELECT id FROM files WHERE path = $1`,
    ['/org/connections/test_connection']
  );

  if (existing.rows.length === 0) {
    const maxIdResult = await db.exec<{ next_id: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files`, []
    );
    const nextId = maxIdResult.rows[0].next_id;

    await db.exec(
      `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [nextId, 'default_db', '/org/connections/test_connection', 'connection',
       JSON.stringify({ id: 'test_connection', name: 'default_db', type: 'duckdb', config: { file_path: 'test.duckdb' } }),
       '[]', now, now]
    );
  }
}

export async function ensureMxfoodDataset(): Promise<void> {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const p = require('path');
  const datasetPath = p.join(process.cwd(), '..', 'data', 'mxfood.duckdb');
  if (fs.existsSync(datasetPath)) return;

  const dir = p.dirname(datasetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  console.log('📥 Downloading mxfood.duckdb...');
  execSync(
    `curl -fSL -o "${datasetPath}" https://github.com/minusxai/sample_datasets/releases/download/v1.0/mxfood.duckdb`,
    { stdio: 'inherit' }
  );
  console.log('✅ mxfood.duckdb downloaded');
}

export async function addMxfoodConnection(_dbPath: string) {
  const db = getModules().db;
  const now = new Date().toISOString();
  const connectionPath = '/org/connections/mxfood';

  const existing = await db.exec<{ id: number }>(
    `SELECT id FROM files WHERE path = $1`, [connectionPath]
  );
  if (existing.rows.length === 0) {
    const maxIdResult = await db.exec<{ next_id: number }>(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM files`, []
    );
    const nextId = maxIdResult.rows[0].next_id;
    await db.exec(
      `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [nextId, 'mxfood', connectionPath, 'connection',
       JSON.stringify({ id: 'mxfood', name: 'mxfood', type: 'duckdb', config: { file_path: 'data/mxfood.duckdb' } }),
       '[]', now, now]
    );
  }
}

// ── main harness ──────────────────────────────────────────────────────────────

/**
 * Sets up an isolated test database for a suite.
 *
 * - Each unique dbPath gets its own PostgreSQL schema (data isolation between suites).
 * - Schema DDL runs once per (adapter × schema) pair; the adapter is reused across
 *   suites in the same file, so only the first suite per new schema pays the DDL cost.
 * - Each test gets a fast, ATOMIC data reset: a single adapter.exec() call that does
 *   SET search_path + DELETE + INSERT with no JS event-loop yields, preventing async
 *   listeners from previous tests from interleaving.
 */
export function setupTestDb(dbPath: string, options: TestDbOptions = {}): TestDbHarness {
  const { customInit, withTestConnection = false } = options;
  const schemaName = schemaFromPath(dbPath);
  let store: ReturnType<typeof setupTestStore>;
  let preparedInitData: InitData;

  beforeAll(async () => {
    // Initialise schema DDL once per (adapter × schemaName).
    // Subsequent suites in this file with the same dbPath skip DDL entirely.
    await ensureSchema(schemaName);

    // Cache bcrypt hash across suites — computing it costs ~100ms.
    const g = globalThis as any;
    if (!g.__preparedInitData) {
      g.__preparedInitData = await buildInitData();
    }
    preparedInitData = g.__preparedInitData;
  });

  beforeEach(async () => {
    // Single atomic exec: SET search_path + DELETE all + INSERT template.
    // No JS yields during this call, so async listeners from previous tests
    // cannot interleave and cause duplicate-key constraint violations.
    const testConnectionJson = withTestConnection
      ? JSON.stringify({ id: 'test_connection', name: 'default_db', type: 'duckdb', config: { file_path: 'test.duckdb' } })
      : undefined;
    const sql = buildImportSQL(preparedInitData, schemaName, testConnectionJson);
    await getModules().db.exec(sql);

    if (customInit) {
      await customInit(dbPath);
    }
    store = setupTestStore();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    store = null as any;
    if (global.gc) global.gc();
  });

  afterAll(async () => {
    // INTENTIONAL NO-OP: keep the PGLite adapter alive for subsequent suites in
    // this file. Module registry is reset between files, so the adapter is GC'd
    // when the worker exits. Calling resetAdapter() here would cause the next
    // suite to pay the full schema DDL cost again.
  });

  return { getStore: () => store };
}
