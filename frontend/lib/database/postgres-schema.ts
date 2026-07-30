import { POSTGRES_SCHEMA as POSTGRES_SCHEMA_NAME } from '@/lib/config';
import { renderSchema } from './schema/render';
import { TABLES } from './schema/tables';

/**
 * Split a SQL string into individual statements, correctly handling dollar-quoted
 * strings ($$...$$, $tag$...$tag$) so semicolons inside them are not treated as
 * statement terminators. Used by both PGLite and Postgres adapters.
 */
export function splitSQLStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollarTag: string | null = null;
  let i = 0;

  while (i < sql.length) {
    if (dollarTag === null) {
      if (sql[i] === '$') {
        let j = i + 1;
        while (j < sql.length && sql[j] !== '$' && /\w/.test(sql[j])) j++;
        if (j < sql.length && sql[j] === '$') {
          dollarTag = sql.slice(i, j + 1);
          current += dollarTag;
          i = j + 1;
          continue;
        }
      }
      if (sql[i] === ';') {
        const stmt = current.trim();
        if (stmt) statements.push(stmt);
        current = '';
        i++;
        continue;
      }
    } else if (sql.startsWith(dollarTag, i)) {
      current += dollarTag;
      i += dollarTag.length;
      dollarTag = null;
      continue;
    }
    current += sql[i++];
  }

  const last = current.trim();
  if (last) statements.push(last);
  return statements;
}

/**
 * The schema, rendered from the declaration in ./schema/tables.ts.
 *
 * This used to be ~400 lines of SQL text. It is generated now so that a deployment
 * needing a variant of the schema can map over the declaration instead of restating
 * every table — two copies of a schema drift, and `IF NOT EXISTS` hides the drift by
 * matching on name rather than definition.
 *
 * The equivalence test in ./schema/__tests__ pins the rendered output against the
 * catalog the old text produced.
 */
export const POSTGRES_SCHEMA = renderSchema(TABLES, { schemaName: POSTGRES_SCHEMA_NAME });
