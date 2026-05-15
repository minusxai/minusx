// Shared "+prompt" pass internals for the V2 data tools.
//
// The orchestrating method lives on `V2DataTool` (see data-tool-base.ts) so
// it can read `this.context` / `this.orchestrator` / `this.id` directly —
// the tool never has to plumb those through. This file exports only the
// pure pieces (types, system prompt, pure builders/parsers) the method
// composes together.

import 'server-only';
import type { AssistantMessage, Context, TextContent } from '@mariozechner/pi-ai';
import type { QueryResult } from '@/lib/connections/base';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import type { Api, Model } from '@/lib/llm/get-model';

/** Stateless LLM-call shape `runPromptPassFree` accepts. The tool-based path
 *  binds `Orchestrator.callLLM` here; the catalog-build path uses a thinner
 *  wrapper (no per-agent telemetry plumbing). */
export type PromptPassCallLLM = (model: Model<Api>, context: Context) => Promise<AssistantMessage>;

// Rows shown to the prompt model per result. The model re-ranks within these;
// the full result stays addressable via its handle.
export const PROMPT_ROW_CAP = 100;

// Each row gets a short synthetic id (`r0`, `r1`, …) within its result set.
// Content-reference re-rank (rerankedIds) instead of positional indices —
// unknown ids skip per-row, duplicates dedupe, no positional counting.
export function rowIdAt(index: number): string {
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

/** Minimal shape `runPromptPass` reads off `this.context` for grounding. */
export interface PromptPassContext {
  contextDocs?: string;
  originalMessage?: string;
}

export const SYSTEM_PROMPT = `You are a data tool. You are given one or more query result sets (each row prefixed with a short row id like "r0:", "r1:") and a task.

Do BOTH of these:
1. For each result set, optionally return "rerankedIds": an array of row ids — a reordering and/or filtering of THAT set's rows, most relevant first, for the task. Use ONLY the row ids shown for that set (copy the literal strings, e.g. "r3"). Use null if no reordering helps. Never invent rows or values.
2. Write a brief, factual "info" string answering the task across all result sets. Reference values/handles — do NOT paste row data back.

Respond with ONLY a JSON object — no prose, no code fences:
{"results":[{"rerankedIds":["<id>",...] | null}, ...],"info":"<text>"}`;

export function extractText(msg: AssistantMessage): string {
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
export function applyRerank(
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

/** Build the user-message content for the prompt-pass LLM call. Pure. */
export function buildPromptPassUserContent(
  entries: PromptPassEntry[],
  prompt: string,
  context: PromptPassContext,
): string {
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

  // Orient the lighter model: original user question first, then dataset
  // docs, then result sets, then the task. Each grounding section is
  // optional — absent ones simply don't appear.
  return [
    context.originalMessage ? `## Original question\n${context.originalMessage}` : null,
    context.contextDocs ? `## Data Documentation\n${context.contextDocs}` : null,
    sections,
    `## Task\n${prompt}`,
  ].filter(Boolean).join('\n\n');
}

/** Build the LLM `Context` for the prompt-pass call. Pure. */
export function buildPromptPassContext(
  entries: PromptPassEntry[],
  prompt: string,
  context: PromptPassContext,
): Context {
  return {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPromptPassUserContent(entries, prompt, context), timestamp: Date.now() }],
    tools: [],
  };
}

/** Parse the model's JSON response defensively (tolerates code fences,
 *  malformed JSON returns `null`). */
export function parsePromptPassResponse(text: string): ParsedResponse | null {
  try {
    return JSON.parse(stripFences(text)) as ParsedResponse;
  } catch {
    return null;
  }
}

/** Build the final previews from entries + parsed rerank info. Falls back to
 *  the original (un-reranked) rows for any entry the model didn't successfully
 *  rerank. Pure. */
export function buildPromptPassPreviews(
  entries: PromptPassEntry[],
  parsed: ParsedResponse | null,
  maxChars: number = TOOL_MAX_LIMIT_CHARS,
): (string | undefined)[] {
  return entries.map((e, i) => {
    if ('error' in e) return undefined;
    const shown = e.result.rows.slice(0, PROMPT_ROW_CAP);
    const rows = applyRerank(shown, parsed?.results?.[i]?.rerankedIds);
    return compressQueryResult(
      { columns: e.result.columns, types: e.result.types, rows },
      maxChars,
    ).data;
  });
}

/** Pick `info` from a parsed response, falling back to the raw text on parse failure. */
export function pickPromptPassInfo(parsed: ParsedResponse | null, rawText: string): string {
  return parsed && typeof parsed.info === 'string' ? parsed.info : rawText;
}

/**
 * Orchestrator-free prompt pass: bundles the pure pieces with a stateless
 * `callLLM`. Used directly by catalog build (no agent context to read
 * `this.orchestrator` off) and indirectly by `V2DataTool.runPromptPass`
 * (which binds `Orchestrator.callLLM` and forwards).
 */
export async function runPromptPassFree(
  entries: PromptPassEntry[],
  prompt: string,
  model: Model<Api>,
  context: PromptPassContext,
  callLLM: PromptPassCallLLM,
  maxChars: number = TOOL_MAX_LIMIT_CHARS,
): Promise<PromptPassResult> {
  const llmCtx = buildPromptPassContext(entries, prompt, context);
  const text = extractText(await callLLM(model, llmCtx));
  const parsed = parsePromptPassResponse(text);
  return {
    previews: buildPromptPassPreviews(entries, parsed, maxChars),
    info: pickPromptPassInfo(parsed, text),
  };
}
