/**
 * Declaration → SQL.
 *
 * The output is idempotent: it is applied on every boot, so every statement is
 * `IF NOT EXISTS` / `OR REPLACE` and re-applying must be a no-op. Columns are also
 * emitted as `ADD COLUMN IF NOT EXISTS`, so a database created by an earlier
 * declaration picks up new ones without a separate migration step.
 *
 * Statement ORDER is significant only for dependencies (a table before its indexes);
 * it carries no other meaning, and equivalence is judged on the resulting catalog
 * rather than on this text.
 */

import type { Column, Index, IndexColumn, Schema, Table } from './types';

function renderIndexColumn(col: IndexColumn): string {
  if (typeof col === 'string') return col;
  if ('expression' in col) return `(${col.expression})`;
  return `${col.column} DESC`;
}

function renderColumnDefinition(col: Column): string {
  const parts = [col.name, col.type];
  if (col.notNull) parts.push('NOT NULL');
  if (col.default !== undefined) parts.push(`DEFAULT ${col.default}`);
  if (col.check) parts.push(`CHECK(${col.check})`);
  return parts.join(' ');
}

function renderIndex(table: string, index: Index): string {
  const unique = index.unique ? 'UNIQUE ' : '';
  const using = index.using ? ` USING ${index.using}` : '';
  const cols = index.columns.map(renderIndexColumn).join(', ');
  const opclass = index.opclass ? ` ${index.opclass}` : '';
  const where = index.where ? ` WHERE ${index.where}` : '';
  return `CREATE ${unique}INDEX IF NOT EXISTS ${index.name} ON ${table}${using} (${cols}${opclass})${where};`;
}

/**
 * All four `updated_at` triggers in the schema have identical bodies, so they are
 * generated from a flag. Names follow the existing convention exactly — renaming
 * them would drop and recreate every trigger on the next boot.
 */
function renderTouchUpdatedAt(table: string): string[] {
  const fn = `update_${table}_updated_at`;
  return [
    `CREATE OR REPLACE FUNCTION ${fn}()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;`,
    `DROP TRIGGER IF EXISTS ${fn}_trigger ON ${table};`,
    `CREATE TRIGGER ${fn}_trigger
  BEFORE UPDATE ON ${table}
  FOR EACH ROW
  EXECUTE FUNCTION ${fn}();`,
  ];
}

export function renderTable(table: Table): string[] {
  const body: string[] = table.columns.map(c => `    ${renderColumnDefinition(c)}`);

  // Always table-level, never inline, so the constraint is auto-named <table>_pkey —
  // which is what `ON CONFLICT ON CONSTRAINT` targets.
  body.push(`    PRIMARY KEY (${table.primaryKey.join(', ')})`);
  for (const u of table.uniques ?? []) {
    body.push(`    UNIQUE (${u.columns.join(', ')})`);
  }

  const statements = [
    `CREATE TABLE IF NOT EXISTS ${table.name} (\n${body.join(',\n')}\n  );`,
    // Lets a database built from an older declaration gain newly-declared columns.
    // A no-op on a table that already has them.
    ...table.columns.map(
      c => `ALTER TABLE ${table.name} ADD COLUMN IF NOT EXISTS ${renderColumnDefinition(c)};`,
    ),
    ...(table.indexes ?? []).map(i => renderIndex(table.name, i)),
  ];

  if (table.touchUpdatedAt) statements.push(...renderTouchUpdatedAt(table.name));

  return statements;
}

export function renderSchema(schema: Schema, { schemaName }: { schemaName?: string } = {}): string {
  const statements: string[] = [];
  if (schemaName) statements.push(`CREATE SCHEMA IF NOT EXISTS ${schemaName};`);
  for (const table of schema) statements.push(...renderTable(table));
  return statements.join('\n\n  ').replace(/^/, '\n  ') + '\n';
}
