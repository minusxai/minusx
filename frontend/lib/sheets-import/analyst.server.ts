import 'server-only';

/**
 * Transform-authoring agent — stage 2 of the agentic Sheets import (see types.ts).
 *
 * A bounded LLM loop on the shared micro-task infra (`micro.sheets_import` prompt, analyst
 * model): the raw grids are sampled positionally into the prompt, the LLM proposes a
 * transforms JSON, and EVERY proposed SQL is validated by actually executing a preview —
 * failures (with their DuckDB errors) are fed back for self-repair. A transform this module
 * returns has provably run. Revisions (user feedback on the review UI) go through the same
 * loop with the previous transforms + feedback in the prompt.
 */

import { runMicroTask } from '@/lib/chat/run-micro-task.server';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { sanitizeTableName, ensureUniqueTableNames } from '@/lib/csv-utils';
import { previewTransform, queryRawGrids } from './executor';
import type { RawGridFile, SheetTransform, TransformPreview } from './types';

const SAMPLE_ROWS = 40;
const MAX_CELL_CHARS = 60;
const PREVIEW_LIMIT = 20;

// ── Grid sampling ─────────────────────────────────────────────────────────────

function renderCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS - 1)}…` : s;
}

/**
 * Positional sample of every grid for the prompt: header line of spreadsheet column letters,
 * then the first SAMPLE_ROWS rows as `row_num | A | B | …` — the same addressing the SQL uses.
 */
export async function sampleRawGridsForPrompt(
  rawFiles: RawGridFile[],
  mode = 'org',
  connectionName = 'static',
): Promise<string> {
  const sections: string[] = [];
  for (const f of rawFiles) {
    const rows = await queryRawGrids(
      rawFiles,
      `SELECT * FROM raw."${f.table_name}" ORDER BY row_num LIMIT ${SAMPLE_ROWS}`,
      mode,
      connectionName,
    );
    const colNames = rows.length ? Object.keys(rows[0]) : ['row_num'];
    const lines = [
      `### Tab "${f.tab_name}" → raw.${f.table_name} (${f.n_rows} rows × ${f.n_cols} cols${f.n_rows > SAMPLE_ROWS ? `, first ${SAMPLE_ROWS} rows shown` : ''})`,
      colNames.join(' | '),
    ];
    for (const row of rows) lines.push(colNames.map(c => renderCell(row[c])).join(' | '));
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

// ── LLM response parsing / normalization ──────────────────────────────────────

interface ProposedTransform {
  output_table?: unknown;
  schema_name?: unknown;
  source_tables?: unknown;
  sql?: unknown;
  description?: unknown;
}

/** Tolerant parse: the transforms JSON may be wrapped in prose / markdown fences. */
export function parseTransformsResponse(text: string): ProposedTransform[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('LLM response contains no JSON object');
  const parsed = JSON.parse(text.slice(start, end + 1)) as { transforms?: unknown };
  if (!Array.isArray(parsed.transforms)) throw new Error('LLM response has no `transforms` array');
  return parsed.transforms as ProposedTransform[];
}

/** Normalize proposals into well-formed SheetTransforms (names sanitized + uniquified). */
function normalizeTransforms(proposals: ProposedTransform[], rawFiles: RawGridFile[]): SheetTransform[] {
  const knownTables = new Set(rawFiles.map(f => f.table_name));
  const usable = proposals.filter(p => typeof p.sql === 'string' && p.sql.trim());
  const names = ensureUniqueTableNames(usable.map((p, i) => String(p.output_table ?? `table_${i + 1}`)));
  return usable.map((p, i) => {
    const requested = String(p.output_table ?? `table_${i + 1}`);
    const sources = Array.isArray(p.source_tables)
      ? p.source_tables.map(String).filter(t => knownTables.has(t))
      : [];
    return {
      output_table: names.get(requested) ?? sanitizeTableName(requested),
      schema_name: typeof p.schema_name === 'string' && p.schema_name.trim() ? p.schema_name : 'public',
      source_tables: sources,
      sql: String(p.sql),
      description: typeof p.description === 'string' ? p.description : '',
    };
  });
}

// ── The authoring loop ────────────────────────────────────────────────────────

export interface AuthorTransformsParams {
  rawFiles: RawGridFile[];
  user: EffectiveUser;
  mode?: string;
  connectionName?: string;
  /** Revision context: the transforms currently shown in the review UI. */
  previousTransforms?: SheetTransform[];
  /** Revision context: the user's feedback on those transforms. */
  feedback?: string;
  maxAttempts?: number;
}

export interface AuthoredTransforms {
  transforms: SheetTransform[];
  /** Executed preview per output_table — proof each transform runs, and the UI's table preview. */
  previews: Record<string, TransformPreview>;
  /** Transforms dropped after exhausting repair attempts (message per drop). Empty on full success. */
  dropped: string[];
}

export async function authorSheetTransforms(params: AuthorTransformsParams): Promise<AuthoredTransforms> {
  const {
    rawFiles,
    user,
    mode = 'org',
    connectionName = 'static',
    previousTransforms,
    feedback,
    maxAttempts = 3,
  } = params;

  const grids = await sampleRawGridsForPrompt(rawFiles, mode, connectionName);
  let errorsVar = '';
  let lastValid: { transforms: SheetTransform[]; previews: Record<string, TransformPreview> } = { transforms: [], previews: {} };
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await runMicroTask('sheets_import', {
      grids,
      previous_transforms: previousTransforms ? JSON.stringify(previousTransforms, null, 2) : '',
      feedback: feedback ?? '',
      errors: errorsVar,
    }, user);

    let transforms: SheetTransform[];
    try {
      transforms = normalizeTransforms(parseTransformsResponse(response), rawFiles);
    } catch (err) {
      lastErrors = [`Response parsing failed: ${err instanceof Error ? err.message : String(err)}`];
      errorsVar = lastErrors.join('\n');
      continue;
    }

    const valid: SheetTransform[] = [];
    const previews: Record<string, TransformPreview> = {};
    const failures: string[] = [];
    for (const t of transforms) {
      try {
        previews[t.output_table] = await previewTransform(rawFiles, t, PREVIEW_LIMIT, mode, connectionName);
        valid.push(t);
      } catch (err) {
        failures.push(`- ${t.output_table}: ${err instanceof Error ? err.message : String(err)}\n  SQL: ${t.sql.trim()}`);
      }
    }

    if (valid.length > 0 && failures.length === 0) {
      return { transforms: valid, previews, dropped: [] };
    }
    lastValid = { transforms: valid, previews };
    lastErrors = failures.length ? failures : ['The response proposed no runnable transforms.'];
    errorsVar = lastErrors.join('\n');
  }

  // Out of attempts: return what validated (partial success), or fail loudly if nothing did.
  if (lastValid.transforms.length > 0) {
    return { ...lastValid, dropped: lastErrors };
  }
  throw new Error(`Could not author any valid transforms after ${maxAttempts} attempts:\n${lastErrors.join('\n')}`);
}
