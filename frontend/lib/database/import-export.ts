/**
 * Reusable import/export functions for database management
 * Shared between CLI scripts and admin APIs
 */

import { DbRow } from './documents-db';
import { User } from './user-db';
import { DbFile } from '../types';
import { getDataVersion } from './config-db';
import { LATEST_DATA_VERSION, LATEST_SCHEMA_VERSION } from './constants';
import { hashPassword } from '../auth/password-utils';
import workspaceTemplate from './workspace-template.json';
import { getModules } from '../modules/registry';

/**
 * Document structure for export/import — same shape as DbFile
 */
export type ExportedDocument = DbFile;

/**
 * @deprecated Nested workspace format. Use flat InitData (users + documents) instead.
 * Kept for backward compatibility with V33-V35 migration code.
 */
export interface OrgData {
  id: number;
  name: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  users: User[];
  documents: ExportedDocument[];
}


/**
 * Flat database export/import format.
 *
 * For the new flat format, populate `users` and `documents`.
 * For legacy data with nested format, populate `orgs` — `importToDatabase`
 * and `validateInitData` both flatten it automatically.
 * At least one of (users+documents) or orgs must be present.
 */
export interface InitData {
  version: number;
  /** Flat list of users. Required in new format; omit when using legacy `orgs`. */
  users?: User[];
  /** Flat list of documents. Required in new format; omit when using legacy `orgs`. */
  documents?: ExportedDocument[];
  /** @deprecated Legacy nested format. Flattened automatically on import. */
  orgs?: OrgData[];
  /** @deprecated Older alias for `orgs`. Still accepted on import for backward compat. */
  companies?: OrgData[];
}

/**
 * Export entire database to InitData format.
 * _dbPath is accepted for API compat but ignored.
 */
export async function exportDatabase(_dbPath: string = ''): Promise<InitData> {
  const db = getModules().db;

  const currentVersion = await getDataVersion();

  const usersResult = await db.exec<User>('SELECT * FROM users ORDER BY id', []);
  const users = usersResult.rows;

  const docsResult = await db.exec<DbRow>('SELECT * FROM files ORDER BY updated_at DESC', []);

  const documents: ExportedDocument[] = docsResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    path: row.path,
    type: row.type as any,
    references: JSON.parse(row.file_references || '[]'),
    content: JSON.parse(row.content),
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version ?? 1,
    last_edit_id: row.last_edit_id ?? null,
  }));

  users.sort((a, b) => a.id - b.id);
  documents.sort((a, b) => a.id - b.id);

  return { version: currentVersion, users, documents };
}

/**
 * Import data to database.
 * dbPath is accepted for API compat but ignored.
 */
export async function importToDatabase(_dbPath: string, initData: InitData): Promise<void> {
  const { users, documents } = resolveFlatData(initData);
  const db = getModules().db;

  await db.exec('DELETE FROM files');
  await db.exec('DELETE FROM users');

  for (const user of users) {
    await db.exec(
      'INSERT INTO users (id, email, name, password_hash, phone, state, home_folder, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [user.id, user.email, user.name, user.password_hash || null, user.phone || null, user.state || null, user.home_folder ?? '', user.role || 'viewer', user.created_at, user.updated_at],
    );
  }

  for (const doc of documents) {
    await db.exec(
      'INSERT INTO files (id, name, path, type, content, file_references, version, last_edit_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
      [doc.id, doc.name, doc.path, doc.type, JSON.stringify(doc.content), JSON.stringify((doc as any).references || []), (doc as any).version ?? 1, (doc as any).last_edit_id ?? null, doc.created_at, doc.updated_at],
    );
  }

  await db.exec(`DELETE FROM configs WHERE key IN ('data_version', 'schema_version')`);
  await db.exec(`INSERT INTO configs (key, value) VALUES ('data_version', $1)`, [initData.version.toString()]);
  await db.exec(`INSERT INTO configs (key, value) VALUES ('schema_version', $1)`, [LATEST_SCHEMA_VERSION.toString()]);
}

/**
 * Resolve flat users/documents arrays from either the new flat format
 * or the legacy nested format.
 */
function resolveFlatData(initData: any): { users: User[]; documents: ExportedDocument[] } {
  const nested = initData.orgs ?? initData.companies;
  if (Array.isArray(nested)) {
    // Legacy format: flatten nested orgs → users + documents
    const users: User[] = [];
    const documents: ExportedDocument[] = [];
    for (const org of nested) {
      if (Array.isArray(org.users)) users.push(...org.users);
      if (Array.isArray(org.documents)) documents.push(...org.documents);
    }
    return { users, documents };
  }
  return {
    users: initData.users ?? [],
    documents: initData.documents ?? [],
  };
}

/**
 * Atomic import.
 * _targetDbPath is accepted for API compat but ignored.
 */
export async function atomicImport(initData: InitData, _targetDbPath: string = ''): Promise<void> {
  await importToDatabase('', initData);
}

function escapeForJson(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

/**
 * Build InitData from the workspace template without importing it.
 * Pre-computes the bcrypt hash so callers can reuse this for fast per-test
 * data resets (atomicImport only) without rehashing on every test.
 */
export async function buildInitData(
  adminName = 'Test User',
  adminEmail = 'test@example.com',
  adminPassword = 'password',
): Promise<InitData> {
  const hash = await hashPassword(adminPassword);
  const now = new Date().toISOString();
  const templateStr = JSON.stringify(workspaceTemplate)
    .replace(/\{\{ORG_NAME\}\}/g, escapeForJson('org'))
    .replace(/\{\{ADMIN_EMAIL\}\}/g, escapeForJson(adminEmail))
    .replace(/\{\{ADMIN_NAME\}\}/g, escapeForJson(adminName))
    .replace(/\{\{ADMIN_PASSWORD_HASH\}\}/g, escapeForJson(hash))
    .replace(/\{\{TIMESTAMP\}\}/g, escapeForJson(now));
  const rawData: InitData = JSON.parse(templateStr);
  rawData.version = LATEST_DATA_VERSION;
  return rawData;
}

/** Initialize the database with a default admin user and seed resources. */
export async function initializeDatabase(
  adminName: string,
  adminEmail: string,
  adminPassword: string,
  _dbPath: string = '',
): Promise<{ userId: number; adminEmail: string }> {
  const hash = await hashPassword(adminPassword);
  const now = new Date().toISOString();

  const templateStr = JSON.stringify(workspaceTemplate)
    .replace(/\{\{ORG_NAME\}\}/g, escapeForJson('org'))
    .replace(/\{\{ADMIN_EMAIL\}\}/g, escapeForJson(adminEmail))
    .replace(/\{\{ADMIN_NAME\}\}/g, escapeForJson(adminName))
    .replace(/\{\{ADMIN_PASSWORD_HASH\}\}/g, escapeForJson(hash))
    .replace(/\{\{TIMESTAMP\}\}/g, escapeForJson(now));

  const rawData: InitData = JSON.parse(templateStr);
  rawData.version = LATEST_DATA_VERSION;
  await atomicImport(rawData);

  return { userId: 1, adminEmail };
}
