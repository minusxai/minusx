// Dump every LLM call referenced in a benchmark output JSONL.
//
// Reads `_lllmCallId` from each `toolCall` content item, hits the
// mx-llm proxy at `${MX_API_BASE_URL}/calls/<id>?mode=all`, and writes
// one `<id>.json` per call into the target directory.
//
// Run:
//   cd frontend
//   node --env-file=.env node_modules/.bin/tsx scripts/dump-llm-calls.ts \
//     <input.jsonl> <output-dir>
//
// Example:
//   node --env-file=.env node_modules/.bin/tsx scripts/dump-llm-calls.ts \
//     ~/Downloads/output_PATENTS.jsonl ./llm-calls/patents

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface ContentItem {
  type?: string;
  _lllmCallId?: string;
}
interface Message {
  role?: string;
  content?: string | ContentItem[];
  /** `callLLM` attaches `_lllmCallId` here for text-only stops (no
   *  toolCalls to hang it off). For tool-use stops it lives on the
   *  first toolCall content item instead. See
   *  `lib/chat-translator/index.ts:240-242`. */
  _lllmCallId?: string;
}

/**
 * Walk every assistant message in every log of every row of the input
 * JSONL and collect distinct `_lllmCallId` values. Handles both shapes:
 *
 *   - tool-use stop: `_lllmCallId` lives on the first toolCall in `content`.
 *   - text-only stop: `_lllmCallId` lives on the assistant message itself.
 *
 * Sub-agent calls are captured automatically — every sub-agent's
 * assistant messages live at the top level of `log[]` (distinguished by
 * `parent_id`), so we just walk the flat array.
 *
 * Pure function so we can unit-test it without network.
 */
export function extractCallIds(jsonlText: string): string[] {
  const ids = new Set<string>();
  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: { log?: Message[]; logs?: Message[][] };
    try {
      row = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed line
    }
    const logs: Message[][] = row.logs ?? (row.log ? [row.log] : []);
    for (const log of logs) {
      for (const msg of log) {
        if (msg.role !== 'assistant') continue;
        if (msg._lllmCallId) ids.add(msg._lllmCallId);
        if (Array.isArray(msg.content)) {
          for (const c of msg.content) {
            if (c?._lllmCallId) ids.add(c._lllmCallId);
          }
        }
      }
    }
  }
  return [...ids];
}

async function fetchCall(baseUrl: string, apiKey: string | undefined, id: string): Promise<unknown | null> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['mx-api-key'] = apiKey;
  const res = await fetch(`${baseUrl}/calls/${id}?mode=all`, { headers });
  if (!res.ok) {
    console.warn(`  [skip] ${id} — HTTP ${res.status}`);
    return null;
  }
  return res.json();
}

async function main(): Promise<void> {
  const [inputPath, outDir] = process.argv.slice(2);
  if (!inputPath || !outDir) {
    console.error('Usage: tsx scripts/dump-llm-calls.ts <input.jsonl> <output-dir>');
    process.exit(2);
  }

  const baseUrl = process.env.MX_API_BASE_URL;
  if (!baseUrl) {
    console.error('MX_API_BASE_URL is not set. Run with --env-file=.env (npm scripts already do this).');
    process.exit(2);
  }
  const apiKey = process.env.MX_API_KEY;

  const text = readFileSync(inputPath, 'utf-8');
  const ids = extractCallIds(text);
  console.log(`Found ${ids.length} unique LLM call IDs in ${inputPath}`);

  mkdirSync(outDir, { recursive: true });

  let ok = 0;
  let skipped = 0;
  for (const id of ids) {
    const body = await fetchCall(baseUrl, apiKey, id);
    if (body == null) {
      skipped++;
      continue;
    }
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify(body, null, 2));
    ok++;
    if (ok % 10 === 0) console.log(`  ...${ok}/${ids.length}`);
  }
  console.log(`Done. Wrote ${ok} call(s) to ${outDir}${skipped ? ` (${skipped} skipped)` : ''}.`);
}

// Only run when executed directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
