/**
 * The schema, declared.
 *
 * Being data rather than SQL text is the whole point: a deployment that needs a
 * variant maps over this instead of restating every table, so the two can no longer
 * drift. See ./types.ts for why there is no raw-SQL field.
 *
 * Conversion is in progress — `postgres-schema.ts` is still the shipped source of
 * truth. Each table added here is checked against it by the equivalence test, which
 * asserts the rendered DDL produces exactly the same catalog.
 */

import type { Schema } from './types';

export const USERS = {
  name: 'users',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'INTEGER', notNull: true },
    { name: 'email', type: 'TEXT', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'password_hash', type: 'TEXT' },
    { name: 'phone', type: 'TEXT' },
    { name: 'state', type: 'TEXT' },
    { name: 'home_folder', type: 'TEXT', notNull: true, default: "''" },
    {
      name: 'role',
      type: 'TEXT',
      notNull: true,
      default: "'viewer'",
      check: "role IN ('admin', 'editor', 'viewer')",
    },
    { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  // Scoped: two namespaces may each have an admin@acme.com. Marking this `global`
  // would make the address unique across the whole deployment.
  uniques: [{ columns: ['email'], scope: 'scoped' }],
  touchUpdatedAt: true,
} as const satisfies Schema[number];

export const FILES = {
  name: 'files',
  scope: 'per-namespace',
  columns: [
    { name: 'id', type: 'INTEGER', notNull: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'path', type: 'TEXT', notNull: true },
    { name: 'type', type: 'TEXT', notNull: true },
    { name: 'content', type: 'JSONB', notNull: true },
    { name: 'file_references', type: 'JSONB', notNull: true, default: "'[]'" },
    { name: 'version', type: 'INTEGER', notNull: true, default: '1' },
    { name: 'last_edit_id', type: 'TEXT' },
    { name: 'draft', type: 'BOOLEAN', notNull: true, default: 'FALSE' },
    { name: 'meta', type: 'JSONB', default: 'NULL' },
    { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['id'],
  // Path uniqueness deliberately is NOT a table constraint: it applies only to
  // published files, so it lives as a partial unique index below and drafts are exempt.
  indexes: [
    { name: 'idx_files_last_edit_id', columns: ['last_edit_id'], where: 'last_edit_id IS NOT NULL' },
    { name: 'idx_files_draft', columns: ['draft'], where: 'draft = true' },
    {
      name: 'idx_files_path_published_unique',
      columns: ['path'],
      unique: true,
      where: 'draft = false',
    },
    { name: 'idx_files_path', columns: ['path'] },
    { name: 'idx_files_updated_at', columns: [{ column: 'updated_at', direction: 'DESC' }] },
    {
      name: 'idx_files_type_updated',
      columns: ['type', { column: 'updated_at', direction: 'DESC' }],
    },
    // Public-share lookup by the nonce in meta.shares[]. Modelled rather than held as
    // raw SQL — an expression index that falls out of the model is invisible to any
    // consumer that rewrites indexes, and ships unscoped.
    {
      name: 'idx_files_meta_shares',
      columns: [{ expression: "meta -> 'shares'" }],
      using: 'gin',
      opclass: 'jsonb_path_ops',
    },
  ],
  touchUpdatedAt: true,
} as const satisfies Schema[number];

export const CONFIGS = {
  name: 'configs',
  scope: 'per-namespace',
  columns: [
    { name: 'key', type: 'TEXT', notNull: true },
    { name: 'value', type: 'TEXT', notNull: true },
    { name: 'updated_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
  ],
  primaryKey: ['key'],
  touchUpdatedAt: true,
} as const satisfies Schema[number];

/** Tables converted to the declaration so far. */
export const TABLES: Schema = [USERS, FILES, CONFIGS];
