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

const SYSTEM_PROMPT = `You are a data tool. You are given one or more query result sets (each row prefixed with its index) and a task.

Do BOTH of these:
1. For each result set, optionally return "rerankedIndices": an array of row indices — a reordering and/or filtering of THAT set's rows, most relevant first, for the task. Use only indices shown for that set. Use null if no reordering helps. Never invent rows or values.
2. Write a brief, factual "info" string answering the task across all result sets. Reference values/handles — do NOT paste row data back.

Respond with ONLY a JSON object — no prose, no code fences:
{"results":[{"rerankedIndices":[<int>,...] | null}, ...],"info":"<text>"}`;

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
  results?: Array<{ rerankedIndices?: number[] | null } | null>;
  info?: string;
}

export async function runPromptPass(
  entries: PromptPassEntry[],
  prompt: string,
  model: Model<Api>,
  orchestrator: Orchestrator,
  toolId: string,
): Promise<PromptPassResult> {
  // Build the indexed view the model re-ranks against.
  const sections = entries
    .map((e, i) => {
      if ('error' in e) return `## [${i}] ${e.label}\nERROR: ${e.error}`;
      const shown = e.result.rows.slice(0, PROMPT_ROW_CAP);
      const indexed = shown.map((r, idx) => `${idx}: ${JSON.stringify(r)}`).join('\n');
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
    let rows = shown;
    const rerank = parsed?.results?.[i]?.rerankedIndices;
    if (Array.isArray(rerank) && rerank.length > 0) {
      const valid = rerank.every(
        (idx) => Number.isInteger(idx) && idx >= 0 && idx < shown.length,
      );
      if (valid) rows = rerank.map((idx) => shown[idx]);
    }
    return compressQueryResult(
      { columns: e.result.columns, types: e.result.types, rows },
      TOOL_MAX_LIMIT_CHARS,
    ).data;
  });

  return { previews, info };
}
