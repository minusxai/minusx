import 'server-only';

import type { Api, Model } from '@/lib/llm/get-model';
import {
  type PromptPassCallLLM,
  type PromptPassContext,
  type RunPromptPassOpts,
  extractText,
} from '../prompt-pass';
import type { JoinFinding } from './joins';
import type { FlatColumn } from './schema';

const SAMPLES_PER_SIDE = 6;

const SYSTEM_PROMPT = `You filter a list of candidate cross-column joins to those that look like real foreign-key / reference relationships.

You are given numbered candidates. Each candidate shows:
- the two columns (table.column, type)
- the mechanical overlap (% of the smaller side's distinct values found in the larger side)
- the kind (direct = raw value match, prefix-strip = match after stripping common prefixes)
- a few sample values from each side

Decide which candidates represent meaningful joins. Reject candidates where:
- the columns are semantically unrelated (e.g. unrelated integer counts that happened to overlap)
- the overlap is incidental (small overlap %, no name affinity)
- both columns are simple bool / status / count enums whose values overlap by construction

Keep candidates where:
- column names suggest a foreign-key relationship (\`id\` ↔ \`<table>_id\`, \`user_id\` on both sides, etc.)
- prefix-strip joins where the stripped values match (e.g. \`businessid_1\` ↔ \`businessref_1\`)
- the sample values look like the same logical identifiers in both columns

Respond with ONLY a JSON array of the candidate indices to keep — no prose, no code fences:
[0, 2, 5]`;

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

/** Defensive parse: returns the set of integer indices the LLM picked.
 *  Empty set on malformed input or non-array shapes. */
export function parseConfirmedIndices(text: string): Set<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(text));
  } catch {
    return new Set();
  }
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<number>();
  for (const v of raw) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out.add(v);
  }
  return out;
}

function colKey(c: FlatColumn): string {
  return `${c.connection}.${c.schema}.${c.table}.${c.column}`;
}

/** Render one candidate block for the LLM prompt. Pure. */
function renderCandidate(
  index: number,
  f: JoinFinding,
  samples: Map<string, unknown[]>,
): string {
  const leftSamples = (samples.get(colKey(f.left)) ?? []).slice(0, SAMPLES_PER_SIDE);
  const rightSamples = (samples.get(colKey(f.right)) ?? []).slice(0, SAMPLES_PER_SIDE);
  return [
    `## [${index}] ${f.left.connection}.${f.left.schema}.${f.left.table}.${f.left.column} (${f.left.type})  ↔  ${f.right.connection}.${f.right.schema}.${f.right.table}.${f.right.column} (${f.right.type})`,
    `kind=${f.kind} overlap=${f.overlap.toFixed(2)}`,
    `left samples:  ${JSON.stringify(leftSamples)}`,
    `right samples: ${JSON.stringify(rightSamples)}`,
  ].join('\n');
}

/** Build the user-message content for the confirm-joins prompt. Pure. */
export function buildConfirmJoinsUserContent(
  candidates: JoinFinding[],
  samples: Map<string, unknown[]>,
  context: PromptPassContext,
): string {
  const sections: string[] = [];
  if (context.originalMessage) sections.push(`## Original question\n${context.originalMessage}`);
  if (context.contextDocs) sections.push(`## Data Documentation\n${context.contextDocs}`);

  const blocks = candidates.map((f, i) => renderCandidate(i, f, samples)).join('\n\n');
  sections.push(`## Candidates\n${blocks}`);
  sections.push(`## Task\nReturn JSON array of indices to keep, per the system rules.`);
  return sections.join('\n\n');
}

/**
 * Single LLM call that filters the mechanically-verified candidates down
 * to those that look like real joins. Fail-open: malformed LLM output
 * keeps all candidates (we'd rather over-include than drop everything).
 */
export async function confirmJoinsLLM(
  candidates: JoinFinding[],
  samples: Map<string, unknown[]>,
  model: Model<Api>,
  callLLM: PromptPassCallLLM,
  context: PromptPassContext,
  opts: RunPromptPassOpts = {},
): Promise<JoinFinding[]> {
  if (candidates.length === 0) return [];

  const effCtx: PromptPassContext = opts.skipUserMessage
    ? { contextDocs: context.contextDocs }
    : context;

  const userContent = buildConfirmJoinsUserContent(candidates, samples, effCtx);
  const llmCtx = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: userContent, timestamp: Date.now() }],
    tools: [],
  };

  const text = extractText(await callLLM(model, llmCtx));
  const kept = parseConfirmedIndices(text);

  // Fail-open: if the LLM returned malformed JSON (empty set with non-empty
  // raw text), keep everything. Mechanical filtering already pruned the
  // obviously-wrong stuff; over-including here is the safer bet.
  if (kept.size === 0 && text.trim().length > 0 && !text.trim().startsWith('[')) {
    return candidates;
  }

  return candidates.filter((_, i) => kept.has(i));
}
