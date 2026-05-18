import 'server-only';

import type { ColumnMeta } from '@/lib/connections/base';
import type { Api, Model } from '@/lib/llm/get-model';
import {
  type PromptPassCallLLM,
  type PromptPassContext,
  type RunPromptPassOpts,
  extractText,
} from '../prompt-pass';

/** Shape of one verified join arc surfaced into a per-table note prompt. */
export interface JoinForNote {
  fromColumn: string;
  toTable: string;
  toColumn: string;
  kind: 'direct' | 'prefix-strip';
  overlap: number;
}

/** Input to `generateTableNotes` — everything the LLM needs to ground its
 *  per-column descriptions in observed data + mechanical signals. */
export interface TableNoteInput {
  connection: string;
  schema: string;
  table: string;
  columns: Array<{ name: string; type: string; meta?: ColumnMeta }>;
  samples: Record<string, unknown>[];
  joinsToTable: JoinForNote[];
}

export interface TableNoteOutput {
  table_note: string;
  columns: Array<{ name: string; note: string }>;
}

const SYSTEM_PROMPT = `You describe one table in a data catalog for a downstream analyst.

You are given:
- The table's columns and their types
- Per-column mechanical stats (cardinality, null count, top values where known)
- A small sample of real rows from the table
- Any verified cross-table joins involving this table

Write:
1. A short "table_note" (1-2 sentences) covering what the table holds and any
   notable storage quirks visible in the samples (nested objects, JSON arrays,
   multi-format strings, embedded delimiters, prefixed strings, unusual codes,
   date formats — only if actually observed).
2. A one-sentence "note" for each column. If a column has unusual structure
   visible in the samples (e.g. nested dict with specific keys, JSON array,
   prefixed values, code patterns, embedded lists in text), describe it.
   Otherwise a brief functional description.

CRITICAL RULES:
- Describe ONLY what is visible in the samples and the mechanical stats.
- Do not invent fields or facts. Do not guess at semantic meaning beyond what
  the samples plus stats support.
- For OBJECT/ARRAY columns, list the keys / element types you actually observe.

Respond with ONLY a JSON object — no prose, no code fences:
{"table_note":"<text>","columns":[{"name":"<col>","note":"<text>"}, ...]}`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseNotesResponse(text: string): TableNoteOutput | null {
  try {
    const parsed = JSON.parse(stripFences(text)) as Partial<TableNoteOutput>;
    if (typeof parsed.table_note !== 'string') return null;
    if (!Array.isArray(parsed.columns)) return null;
    return {
      table_note: parsed.table_note,
      columns: parsed.columns
        .filter((c): c is { name: string; note: string } =>
          c != null && typeof (c as { name?: unknown }).name === 'string' &&
          typeof (c as { note?: unknown }).note === 'string',
        )
        .map((c) => ({ name: c.name, note: c.note })),
    };
  } catch {
    return null;
  }
}

/** Render the user-message content for the notes prompt. Pure. */
export function buildNotesUserContent(
  input: TableNoteInput,
  context: PromptPassContext,
): string {
  const sections: string[] = [];
  if (context.originalMessage) sections.push(`## Original question\n${context.originalMessage}`);
  if (context.contextDocs) sections.push(`## Data Documentation\n${context.contextDocs}`);

  sections.push(`## Table\n${input.connection}.${input.schema}.${input.table}`);

  // Columns + stats summary (terse — keep token cost down).
  const colLines = input.columns.map((c) => {
    const m = c.meta;
    const bits: string[] = [];
    if (m?.category) bits.push(`category=${m.category}`);
    if (m?.nDistinct !== undefined) bits.push(`nDistinct=${m.nDistinct}`);
    if (m?.nullCount !== undefined) bits.push(`nullCount=${m.nullCount}`);
    if (m?.topValues && m.topValues.length > 0) {
      bits.push(`top=${JSON.stringify(m.topValues.slice(0, 5).map((t) => t.value))}`);
    }
    if (m?.min !== undefined) bits.push(`min=${JSON.stringify(m.min)}`);
    if (m?.max !== undefined) bits.push(`max=${JSON.stringify(m.max)}`);
    return `- ${c.name} (${c.type})${bits.length > 0 ? ' — ' + bits.join(', ') : ''}`;
  });
  sections.push(`## Columns\n${colLines.join('\n')}`);

  // Joins involving this table.
  if (input.joinsToTable.length > 0) {
    const joinLines = input.joinsToTable.map(
      (j) => `- ${j.fromColumn} → ${j.toTable}.${j.toColumn} (${j.kind}, overlap=${j.overlap.toFixed(2)})`,
    );
    sections.push(`## Verified joins involving this table\n${joinLines.join('\n')}`);
  }

  // Sample rows (compact JSON, capped to keep tokens bounded).
  const rowLines = input.samples
    .slice(0, 10)
    .map((r, i) => `r${i}: ${JSON.stringify(r)}`)
    .join('\n');
  sections.push(`## Sample rows${input.samples.length > 10 ? ` (showing 10 of ${input.samples.length})` : ''}\n${rowLines || '(no rows)'}`);

  sections.push(`## Task\nWrite the table_note and per-column notes per the system rules. Output JSON only.`);

  return sections.join('\n\n');
}

/**
 * One LLM call → one table's notes. Output is validated against the
 * schema: any column note the LLM hallucinated (column not in
 * `input.columns`) is dropped. Missing column notes are filled with an
 * empty string so the output array shape matches the input columns
 * one-for-one.
 */
export async function generateTableNotes(
  input: TableNoteInput,
  model: Model<Api>,
  callLLM: PromptPassCallLLM,
  context: PromptPassContext,
  opts: RunPromptPassOpts = {},
): Promise<TableNoteOutput> {
  const effCtx: PromptPassContext = opts.skipUserMessage
    ? { contextDocs: context.contextDocs }
    : context;

  const userContent = buildNotesUserContent(input, effCtx);
  const llmCtx = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: userContent, timestamp: Date.now() }],
    tools: [],
  };

  const text = extractText(await callLLM(model, llmCtx));
  const parsed = parseNotesResponse(text);

  const allowed = new Set(input.columns.map((c) => c.name));
  const byName = new Map<string, string>();
  if (parsed) {
    for (const c of parsed.columns) {
      if (allowed.has(c.name) && !byName.has(c.name)) byName.set(c.name, c.note);
    }
  }
  return {
    table_note: parsed?.table_note ?? '',
    columns: input.columns.map((c) => ({ name: c.name, note: byName.get(c.name) ?? '' })),
  };
}
