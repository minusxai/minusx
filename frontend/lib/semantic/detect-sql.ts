/**
 * SQL-string semantic detection — parses with the dialect-aware WASM parser
 * then defers to the pure IR-level `semanticSpecFromIr` (detect.ts).
 *
 * SERVER/TEST ONLY: importing this file pulls @polyglot-sql/sdk (WASM) into
 * the bundle. Client code must call CompletionsAPI.sqlToIR and then
 * `semanticSpecFromIr` (see use-semantic-compat) instead — shipping the WASM
 * parser to the browser bloats every page and its init failure once broke
 * login via a Sentry-tunnel redirect cascade.
 */

import type { AnyQueryIR } from '@/lib/sql/ir-types';
import type { SemanticModelV2 } from '@/lib/types/semantic';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';
import { parseSqlToIrLocal } from '@/lib/sql/sql-to-ir';
import { semanticSpecFromIr } from './detect';

/**
 * Detect whether a SQL string is expressible as a semantic query against the
 * given models. Parses with the connection's dialect; returns null on any
 * parse failure or mapping failure.
 */
export async function detectSemanticQuery(
  sql: string,
  models: SemanticModelV2[],
  dialect: string,
): Promise<SemanticQuerySpec | null> {
  if (!sql.trim() || models.length === 0) return null;
  let ir: AnyQueryIR;
  try {
    ir = await parseSqlToIrLocal(sql, dialect);
  } catch {
    return null;
  }
  return semanticSpecFromIr(ir, models);
}
