/**
 * Relationship verification — turns a declared TableRelationship from a claim
 * into a checked fact by running two real queries against the connection:
 *
 *  1. Target uniqueness: the lookup column must be unique, otherwise the
 *     relationship is NOT many-to-one and every measure through this join
 *     would silently fan out (the exact failure lookup-only joins prevent).
 *  2. Match rate: how many base rows actually find a lookup row (orphaned FK
 *     values don't break anything — joins are LEFT — but the author should
 *     know when a third of the rows won't get lookup dimensions).
 *
 * Both checks are built as QueryIR and rendered per dialect via irToSql — the
 * same generator every other query path uses — so identifier quoting is never
 * hand-rolled here.
 */
import 'server-only';
import { runQuery } from '@/lib/connections/run-query';
import { ConnectionsAPI } from '@/lib/data/connections.server';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { isSelfJoin, validateTableRelationships } from '@/lib/semantic/derive';
import { connectionTypeToDialect } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { TableRelationship } from '@/lib/types';
import type { QueryIR } from '@/lib/sql/ir-types';

export interface RelationshipVerification {
  /** Lookup column is unique — the many-to-one/one-to-one claim holds. */
  targetUnique: boolean;
  /** Base-table row count. */
  totalRows: number;
  /** Base rows whose FK found a lookup row. */
  matchedRows: number;
}

const IR_VERSION = 1;

/**
 * Is the lookup column unique? SELECT COUNT(*) AS c, COUNT(DISTINCT col) AS d —
 * unique iff c == d. A single scan with no GROUP BY materialization, which is
 * dramatically cheaper than GROUP BY … HAVING on large warehouse tables.
 */
function uniquenessIr(r: TableRelationship): QueryIR {
  return {
    version: IR_VERSION,
    select: [
      { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'c' },
      { type: 'aggregate', aggregate: 'COUNT_DISTINCT', column: r.targetColumn, alias: 'd' },
    ],
    from: { table: r.targetTable, schema: r.targetSchema },
    limit: 1,
  };
}

/** SELECT COUNT(*) AS total, COUNT(lk.targetColumn) AS matched FROM base LEFT JOIN target lk ON … */
function matchRateIr(r: TableRelationship): QueryIR {
  return {
    version: IR_VERSION,
    select: [
      { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'total' },
      { type: 'aggregate', aggregate: 'COUNT', column: r.targetColumn, table: 'lk', alias: 'matched' },
    ],
    from: { table: r.table, schema: r.schema },
    joins: [{
      type: 'LEFT',
      table: { table: r.targetTable, schema: r.targetSchema, alias: 'lk' },
      on: [{ left_table: r.table, left_column: r.column, right_table: 'lk', right_column: r.targetColumn }],
    }],
    limit: 1,
  };
}

export async function verifyRelationship(
  user: EffectiveUser,
  relationship: TableRelationship,
): Promise<RelationshipVerification> {
  const issues = validateTableRelationships([relationship]);
  if (issues.length > 0) throw new Error(issues[0]);
  if (isSelfJoin(relationship)) throw new Error('Self-joins are not supported');

  const conn = await ConnectionsAPI.getRawByName(relationship.connection, user.mode);
  const dialect = connectionTypeToDialect(conn.type);

  const [dupes, match] = await Promise.all([
    runQuery(relationship.connection, irToSqlLocal(uniquenessIr(relationship), dialect), {}, user),
    runQuery(relationship.connection, irToSqlLocal(matchRateIr(relationship), dialect), {}, user),
  ]);

  // Rows are keyed records per QueryResult.
  const num = (v: unknown) => (typeof v === 'number' ? v : parseInt(String(v ?? 0), 10) || 0);
  const uniq = (dupes.rows?.[0] ?? {}) as Record<string, unknown>;
  const row = (match.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    // NULLs: COUNT(col) skips them on both sides consistently.
    targetUnique: num(uniq['c']) === num(uniq['d']),
    totalRows: num(row['total']),
    matchedRows: num(row['matched']),
  };
}
