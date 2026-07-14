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
import type { CompoundQueryIR, QueryIR } from '@/lib/sql/ir-types';

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
 * Both checks in ONE round trip (UNION ALL) — warehouse latency and queueing
 * dominate these tiny aggregate results, and some connections serialize
 * queries, so one statement is ~2× faster than two.
 *
 *   SELECT 'uniqueness', COUNT(*), COUNT(DISTINCT col) FROM target
 *     — unique iff the two counts match; a single scan with no GROUP BY
 *       materialization (dramatically cheaper than GROUP BY … HAVING).
 *   UNION ALL
 *   SELECT 'match', COUNT(*), COUNT(lk.col) FROM base LEFT JOIN target lk ON …
 *     — one aggregate row over the join being verified.
 */
function verificationIr(r: TableRelationship): CompoundQueryIR {
  const uniqueness: QueryIR = {
    version: IR_VERSION,
    select: [
      { type: 'raw', raw_sql: "'uniqueness'", alias: 'chk' },
      { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'a' },
      { type: 'aggregate', aggregate: 'COUNT_DISTINCT', column: r.targetColumn, alias: 'b' },
    ],
    from: { table: r.targetTable, schema: r.targetSchema },
  };
  const matchRate: QueryIR = {
    version: IR_VERSION,
    select: [
      { type: 'raw', raw_sql: "'match'", alias: 'chk' },
      { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'a' },
      { type: 'aggregate', aggregate: 'COUNT', column: r.targetColumn, table: 'lk', alias: 'b' },
    ],
    from: { table: r.table, schema: r.schema },
    joins: [{
      type: 'LEFT',
      table: { table: r.targetTable, schema: r.targetSchema, alias: 'lk' },
      on: [{ left_table: r.table, left_column: r.column, right_table: 'lk', right_column: r.targetColumn }],
    }],
  };
  return { type: 'compound', version: IR_VERSION, queries: [uniqueness, matchRate], operators: ['UNION ALL'] };
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

  const result = await runQuery(
    relationship.connection,
    irToSqlLocal(verificationIr(relationship), dialect),
    {},
    user,
  );

  // Two keyed rows, discriminated by `chk` (order is not guaranteed).
  const num = (v: unknown) => (typeof v === 'number' ? v : parseInt(String(v ?? 0), 10) || 0);
  const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
  const uniq = rows.find((r) => String(r['chk']) === 'uniqueness') ?? {};
  const match = rows.find((r) => String(r['chk']) === 'match') ?? {};
  return {
    // NULLs: COUNT(col) skips them on both sides consistently.
    targetUnique: num(uniq['a']) === num(uniq['b']),
    totalRows: num(match['a']),
    matchedRows: num(match['b']),
  };
}
