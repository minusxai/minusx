/**
 * The agent-visible surface (system prompt, dialect hints, tool descriptions)
 * for sqlite contexts must read as pure SQLite — no mention of DuckDB,
 * `jaro_winkler`, `UNNEST`, `REGEXP_EXTRACT`, etc. The benchmark runtime
 * happens to route sqlite through DuckDB-via-ATTACH for stability, but
 * that's an implementation detail the LLM never sees. These tests pin
 * the prompt purity so future edits don't reintroduce DuckDB-isms.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fauxAssistantMessage } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';
import { renderDialectHints } from '../v2/dialect-hints';
import * as autoContextModule from '../v2/auto-context/auto-context';

const REGISTRABLES = [BenchmarkAnalystAgent];

const DUCKDB_LEAK_PATTERNS: RegExp[] = [
  /duckdb/i,
  /jaro_winkler/i,
  /levenshtein/i,
  /\bSUMMARIZE\b/,
  /\bUNNEST\b/,
  /regexp_extract/i,
  /generate_series/i,
  /\bQUALIFY\b/,
  /shared\s+in-memory/i,
  /routes\s+through/i,
];

const SQLITE_NATIVE_PATTERNS: RegExp[] = [
  /json_each/i,
  /json_extract/i,
  /GLOB/,
  /substr/i,
  /\bPOW\b/,
];

async function captureSystemPrompt(ctx: BenchmarkAnalystContext): Promise<string> {
  fauxRegistration.setResponses([
    fauxAssistantMessage('TL;DR: stub', { stopReason: 'stop' }),
  ]);
  const orch = new Orchestrator(REGISTRABLES);
  const root = new BenchmarkAnalystAgent(orch, { userMessage: 'q' }, ctx);
  let systemPrompt = '';
  const origCall = orch.callLLM.bind(orch);
  orch.callLLM = async (m, c, id, opts) => {
    if (!systemPrompt) systemPrompt = c.systemPrompt ?? '';
    return origCall(m, c, id, opts);
  };
  const stream = orch.run(root);
  for await (const _ev of stream) { /* drain */ }
  await stream.result();
  return systemPrompt;
}

function sqliteOnlyCtx(): BenchmarkAnalystContext {
  return {
    connections: [
      { name: 'foo', dialect: 'sqlite', description: 'test', config: { file_path: '/dev/null' } },
    ],
    contextDocs: 'docs',
    datasetKey: 'sqlite-only',
  };
}

describe('benchmark sqlite — prompt cleanliness (no DuckDB leakage)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(autoContextModule, 'ensureAutoContext').mockImplementation(async () => { /* no-op */ });
  });

  it('rendered system prompt for a sqlite-only context contains zero DuckDB references', async () => {
    const prompt = await captureSystemPrompt(sqliteOnlyCtx());
    for (const pat of DUCKDB_LEAK_PATTERNS) {
      expect(prompt, `DuckDB leak: pattern ${pat} matched in system prompt`).not.toMatch(pat);
    }
  });

  it('rendered system prompt for a sqlite-only context exposes native SQLite primitives', async () => {
    const prompt = await captureSystemPrompt(sqliteOnlyCtx());
    for (const pat of SQLITE_NATIVE_PATTERNS) {
      expect(prompt, `missing SQLite-native hint: ${pat}`).toMatch(pat);
    }
  });

  it('duckdb dialect hint does not falsely claim sqlite shares the duckdb instance', () => {
    const hint = renderDialectHints(new Set(['duckdb']));
    // The duckdb hint is rendered when ANY duckdb connection is present.
    // Even in mixed contexts the hint must not promise that sqlite shares
    // the duckdb instance — that is no longer true.
    expect(hint).not.toMatch(/sqlite.+share/i);
    expect(hint).not.toMatch(/share.+sqlite/i);
    expect(hint).not.toMatch(/benchmark.sqlite/i);
  });

  it('mixed sqlite+duckdb prompt still passes the no-leak test for sqlite-relevant guidance', async () => {
    const ctx: BenchmarkAnalystContext = {
      connections: [
        { name: 'a', dialect: 'sqlite', description: 'sqlite db', config: { file_path: '/dev/null' } },
        { name: 'b', dialect: 'duckdb', description: 'duckdb file', config: { file_path: '/dev/null' } },
      ],
      contextDocs: 'docs',
      datasetKey: 'mixed',
    };
    const prompt = await captureSystemPrompt(ctx);
    // duckdb section is allowed to mention DuckDB primitives — that's
    // correct for a duckdb connection. But it must not cross-pollinate
    // into the sqlite hint.
    expect(prompt).not.toMatch(/sqlite.+share/i);
    expect(prompt).not.toMatch(/benchmark.sqlite/i);
  });

  it('tool descriptions do not advertise handle tables on sqlite connections', () => {
    const allDesc = BenchmarkAnalystAgent.tools
      .map((t) => t.description ?? '')
      .join('\n');
    // The current ExecuteQuery description says:
    //   "FROM handle_xyz works whenever the query's connection is DuckDB or sqlite"
    // and "_scratch ... is a DuckDB connection routing to the in-memory
    // catalog where handle tables live. Use _scratch when your dataset
    // has no other DuckDB/sqlite connection..."
    // Both must go — handles do not work on the new sqlite connector.
    expect(allDesc).not.toMatch(/DuckDB or sqlite/i);
    expect(allDesc).not.toMatch(/duckdb\/sqlite/i);
    expect(allDesc).not.toMatch(/sqlite\/duckdb/i);
    expect(allDesc).not.toMatch(/_scratch[^\n]*duckdb/i);
  });
});
