import 'server-only';

import type { QueryResult } from '@/lib/connections/base';
import type { Api, Model } from '@/lib/llm/get-model';
import {
  type PromptPassCallLLM,
  type PromptPassContext,
  type RunPromptPassOpts,
  extractText,
} from '../prompt-pass';

const DEFAULT_MAX_EXAMPLES = 5;
const DEFAULT_ROWS_PER_EXAMPLE = 5;

/** A successfully-executed example query, ready to surface in the
 *  AutoContext markdown block. */
export interface Example {
  description: string;
  connection: string;
  query: string;
  rows: Record<string, unknown>[];
}

export interface GenerateExamplesOpts extends RunPromptPassOpts {
  /** Cap on the number of executed examples returned. */
  maxExamples?: number;
  /** How many result rows to keep per example. */
  rowsPerExample?: number;
}

const SYSTEM_PROMPT = `You write a small set of demonstration queries for a data catalog.

You are given:
- A summary of the catalog's schema (tables + columns)
- A list of verified findings (e.g. cross-table joins, notable structures)

For each finding, write ONE example query that concretely demonstrates the
finding against the actual data. Each example must:
- be valid syntax for the connection's dialect
- be a read-only query (SELECT or aggregation pipeline; never INSERT/UPDATE/DELETE)
- return a small number of rows (use LIMIT / $limit)
- show the relationship or structure described in its finding

Respond with ONLY a JSON array — no prose, no code fences:
[{"description":"<short text>","connection":"<connection name>","query":"<query string>"}, ...]`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

/** Defensive JSON parse for the examples response. Drops entries that
 *  are missing any required field. Returns `null` on outright parse
 *  failure (caller treats as empty). */
export function parseExamplesResponse(
  text: string,
): Array<{ description: string; connection: string; query: string }> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(text));
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (e): e is { description: string; connection: string; query: string } =>
      e != null &&
      typeof (e as { description?: unknown }).description === 'string' &&
      typeof (e as { connection?: unknown }).connection === 'string' &&
      typeof (e as { query?: unknown }).query === 'string',
  );
}

/** Build the user content for the examples prompt. Pure. */
export function buildExamplesUserContent(
  schemaSummary: string,
  findings: Array<{ description: string; connection: string }>,
  context: PromptPassContext,
): string {
  const sections: string[] = [];
  if (context.originalMessage) sections.push(`## Original question\n${context.originalMessage}`);
  if (context.contextDocs) sections.push(`## Data Documentation\n${context.contextDocs}`);
  sections.push(`## Schema summary\n${schemaSummary}`);
  if (findings.length > 0) {
    const lines = findings.map((f) => `- [${f.connection}] ${f.description}`);
    sections.push(`## Findings to demonstrate\n${lines.join('\n')}`);
  }
  sections.push(`## Task\nWrite one demonstration query per finding per the system rules. Output JSON array only.`);
  return sections.join('\n\n');
}

/**
 * Propose example queries (LLM) → execute each (caller-supplied
 * `executeQuery`) → keep only those that succeed AND return at least
 * one row. Errors and empty results are silently dropped (those
 * examples don't make the cut).
 */
export async function generateExamples(
  schemaSummary: string,
  findings: Array<{ description: string; connection: string }>,
  model: Model<Api>,
  callLLM: PromptPassCallLLM,
  context: PromptPassContext,
  executeQuery: (connection: string, query: string) => Promise<QueryResult>,
  opts: GenerateExamplesOpts = {},
): Promise<Example[]> {
  const maxExamples = opts.maxExamples ?? DEFAULT_MAX_EXAMPLES;
  const rowsPerExample = opts.rowsPerExample ?? DEFAULT_ROWS_PER_EXAMPLE;

  const effCtx: PromptPassContext = opts.skipUserMessage
    ? { contextDocs: context.contextDocs }
    : context;

  const userContent = buildExamplesUserContent(schemaSummary, findings, effCtx);
  const llmCtx = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: userContent, timestamp: Date.now() }],
    tools: [],
  };

  const text = extractText(await callLLM(model, llmCtx));
  const parsed = parseExamplesResponse(text);
  if (parsed == null) return [];

  const out: Example[] = [];
  for (const p of parsed) {
    if (out.length >= maxExamples) break;
    try {
      const result = await executeQuery(p.connection, p.query);
      if (!result || result.rows.length === 0) continue;
      out.push({
        description: p.description,
        connection: p.connection,
        query: p.query,
        rows: result.rows.slice(0, rowsPerExample),
      });
    } catch {
      // Drop on execution error — invalid syntax, missing column, etc.
    }
  }
  return out;
}
