/**
 * Catalog introspection for schema-equivalence tests.
 *
 * `IF NOT EXISTS` matches on NAME, not definition, so a generated object that differs
 * from the deployed one is skipped with only a NOTICE. Comparing the DDL text cannot
 * catch that; comparing what the database actually ended up with can.
 *
 * Returns a stable, sorted description of the live schema — the same role
 * `pg_dump --schema-only | diff` plays for a real Postgres, but usable against PGLite
 * so it runs in the normal test suite instead of needing a container.
 */

import type { IDatabaseAdapter } from '@/lib/database/adapter/types';

export interface ColumnShape {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface IndexShape {
  name: string;
  definition: string;
}

export interface ConstraintShape {
  name: string;
  type: 'p' | 'u' | 'f' | 'c';
  definition: string;
}

export interface TriggerShape {
  name: string;
  timing: string;
  event: string;
  /** Body of the function the trigger executes — a renamed-but-identical trigger is not a difference, a changed body is. */
  functionBody: string;
}

export interface TableShape {
  name: string;
  columns: ColumnShape[];
  indexes: IndexShape[];
  constraints: ConstraintShape[];
  triggers: TriggerShape[];
}

export type SchemaShape = TableShape[];

export async function introspectSchema(adapter: IDatabaseAdapter): Promise<SchemaShape> {
  const { rows: tables } = await adapter.query<{ name: string }>(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = current_schema()
      ORDER BY c.relname`,
  );

  const shapes: SchemaShape = [];

  for (const t of tables) {
    const { rows: columns } = await adapter.query<{
      name: string; type: string; nullable: string; default: string | null;
    }>(
      `SELECT column_name AS name, data_type AS type, is_nullable AS nullable,
              column_default AS default
         FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1
        ORDER BY column_name`,
      [t.name],
    );

    const { rows: indexes } = await adapter.query<{ name: string; definition: string }>(
      `SELECT indexname AS name, indexdef AS definition
         FROM pg_indexes
        WHERE schemaname = current_schema() AND tablename = $1
        ORDER BY indexname`,
      [t.name],
    );

    const { rows: constraints } = await adapter.query<{
      name: string; type: ConstraintShape['type']; definition: string;
    }>(
      `SELECT con.conname AS name, con.contype AS type,
              pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relname = $1
        ORDER BY con.conname`,
      [t.name],
    );

    const { rows: triggers } = await adapter.query<{
      name: string; timing: string; event: string; functionBody: string;
    }>(
      `SELECT tg.tgname AS name,
              CASE WHEN (tg.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
              CASE WHEN (tg.tgtype & 16) <> 0 THEN 'UPDATE'
                   WHEN (tg.tgtype & 4)  <> 0 THEN 'INSERT'
                   WHEN (tg.tgtype & 8)  <> 0 THEN 'DELETE' ELSE 'OTHER' END AS event,
              p.prosrc AS "functionBody"
         FROM pg_trigger tg
         JOIN pg_class c ON c.oid = tg.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = tg.tgfoid
        WHERE NOT tg.tgisinternal AND n.nspname = current_schema() AND c.relname = $1
        ORDER BY tg.tgname`,
      [t.name],
    );

    shapes.push({
      name: t.name,
      columns: columns.map(c => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable === 'YES',
        default: c.default,
      })),
      indexes,
      constraints,
      // Normalised: the trigger's own name is incidental, what it DOES is not.
      triggers: triggers.map(t => ({ ...t, functionBody: t.functionBody.trim().replace(/\s+/g, ' ') })),
    });
  }

  return shapes;
}

/**
 * Human-readable rendering — a diff of this points straight at the offending object,
 * where a diff of two nested objects does not.
 */
export function renderSchemaShape(shape: SchemaShape): string {
  const lines: string[] = [];
  for (const t of shape) {
    lines.push(`TABLE ${t.name}`);
    for (const c of t.columns) {
      lines.push(`  col  ${c.name} ${c.type}${c.nullable ? '' : ' NOT NULL'}${c.default ? ` DEFAULT ${c.default}` : ''}`);
    }
    for (const c of t.constraints) lines.push(`  con  ${c.name} ${c.definition}`);
    for (const i of t.indexes) lines.push(`  idx  ${i.definition}`);
    for (const g of t.triggers) lines.push(`  trg  ${g.timing} ${g.event} -> ${g.functionBody}`);
  }
  return lines.join('\n');
}
