// Shared "+prompt" pass for the V2 data tools.
//
// When SearchDBSchema / ExecuteQuery / Explore are called with a `prompt`, the
// lighter model sees every result set and does two things:
//   1. optionally re-ranks/filters each result's preview rows — selecting from
//      the rows it was *given* (by index), never re-emitting row data;
//   2. writes one bounded, factual `info` summary across all results.
//
// The re-rank is best-effort ("may re-rank"): a malformed response, missing
// field, or out-of-range index leaves that preview in its original order.

import 'server-only';
import type { AssistantMessage, Context, TextContent } from '@mariozechner/pi-ai';
import type { Orchestrator } from '@/orchestrator/orchestrator';
import type { Api, Model } from '@/lib/llm/get-model';
import type { QueryResult } from '@/lib/connections/base';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';

// Rows shown to the prompt model per result. The model re-ranks within these;
// the full result stays addressable via its handle.
const PROMPT_ROW_CAP = 100;

// Each row gets a short synthetic id (`r0`, `r1`, …) within its result set.
// The model re-ranks by **id** (content reference) rather than positional
// index — that means an unknown id skips just that row instead of rejecting
// the whole rerank, duplicate ids dedupe naturally, and the model isn't asked
// to count positions (a known LLM weak spot).
function rowIdAt(index: number): string {
  return `r${index}`;
}

export type PromptPassEntry =
  | { label: string; result: QueryResult }
  | { label: string; error: string };

export interface PromptPassResult {
  /** Compressed preview per entry — re-ranked where the model gave a valid
   *  ordering; `undefined` for error entries. */
  previews: (string | undefined)[];
  /** Single cross-result factual summary. */
  info: string;
}

const SYSTEM_PROMPT = `You are a data tool. You are given one or more query result sets (each row prefixed with a short row id like "r0:", "r1:") and a task.

Do BOTH of these:
1. For each result set, optionally return "rerankedIds": an array of row ids — a reordering and/or filtering of THAT set's rows, most relevant first, for the task. Use ONLY the row ids shown for that set (copy the literal strings, e.g. "r3"). Use null if no reordering helps. Never invent rows or values.
2. Write a brief, factual "info" string answering the task across all result sets. Reference values/handles — do NOT paste row data back.

Respond with ONLY a JSON object — no prose, no code fences:
{"results":[{"rerankedIds":["<id>",...] | null}, ...],"info":"<text>"}`;

function extractText(msg: AssistantMessage): string {
  return msg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

interface ParsedResponse {
  results?: Array<{ rerankedIds?: unknown } | null>;
  info?: string;
}

/** Apply the model's id list to an entry's shown rows. Unknown ids and
 *  duplicates are skipped per-row; an empty result keeps the original order. */
function applyRerank(
  shown: Record<string, unknown>[],
  rerankIds: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(rerankIds) || rerankIds.length === 0) return shown;
  const idMap = new Map<string, Record<string, unknown>>();
  shown.forEach((row, idx) => idMap.set(rowIdAt(idx), row));
  const seen = new Set<string>();
  const picked: Record<string, unknown>[] = [];
  for (const id of rerankIds) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const row = idMap.get(id);
    if (row !== undefined) {
      picked.push(row);
      seen.add(id);
    }
  }
  return picked.length > 0 ? picked : shown;
}

export async function runPromptPass(
  entries: PromptPassEntry[],
  prompt: string,
  model: Model<Api>,
  orchestrator: Orchestrator,
  toolId: string,
): Promise<PromptPassResult> {
  // Build the id-prefixed view the model re-ranks against.
  const sections = entries
    .map((e, i) => {
      if ('error' in e) return `## [${i}] ${e.label}\nERROR: ${e.error}`;
      const shown = e.result.rows.slice(0, PROMPT_ROW_CAP);
      const indexed = shown.map((r, idx) => `${rowIdAt(idx)}: ${JSON.stringify(r)}`).join('\n');
      const more =
        e.result.rows.length > shown.length
          ? ` (showing ${shown.length} of ${e.result.rows.length})`
          : '';
      return `## [${i}] ${e.label}${more}\n${indexed || '(no rows)'}`;
    })
    .join('\n\n');

  const ctx: Context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: `${sections}\n\n## Task\n${prompt}`, timestamp: Date.now() },
    ],
    tools: [],
  };
  const text = extractText(await orchestrator.callLLM(model, ctx, toolId, { maxTokens: 4096 }));

  // Parse defensively — the re-rank is best-effort.
  let parsed: ParsedResponse | null = null;
  try {
    parsed = JSON.parse(stripFences(text)) as ParsedResponse;
  } catch {
    parsed = null;
  }
  const info = parsed && typeof parsed.info === 'string' ? parsed.info : text;

  const previews = entries.map((e, i) => {
    if ('error' in e) return undefined;
    const shown = e.result.rows.slice(0, PROMPT_ROW_CAP);
    const rows = applyRerank(shown, parsed?.results?.[i]?.rerankedIds);
    return compressQueryResult(
      { columns: e.result.columns, types: e.result.types, rows },
      TOOL_MAX_LIMIT_CHARS,
    ).data;
  });

  return { previews, info };
}
