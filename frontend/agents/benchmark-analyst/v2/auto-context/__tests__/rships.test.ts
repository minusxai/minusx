/**
 * Tests for rships.ts — the AutoContext orchestrator.
 *
 * Every stage (joins, samples, notes, examples, filter) is exposed as a
 * dependency so this test file can verify orchestration without touching
 * a DB or the network. The real wire-up (using catalog + connectors +
 * pi-ai) lives in index.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ColumnMeta } from '@/lib/connections/base';
import {
  getRshipsNStructure,
  estimateSchemaChars,
  clearRshipsCache,
  type RshipsDeps,
} from '../rships';
import type { FlatColumn } from '../schema';

const col = (table: string, column: string, type = 'INTEGER'): FlatColumn => ({
  connection: 'db',
  schema: 'public',
  table,
  column,
  type,
});

const baseDeps = (overrides: Partial<RshipsDeps> = {}): RshipsDeps => ({
  fetchSampleValues: vi.fn(async () => ['v1', 'v2']),
  fetchTableSample: vi.fn(async () => [{ id: 1 }]),
  generateTableNotes: vi.fn<RshipsDeps['generateTableNotes']>(async (input) => ({
    table_note: `note for ${input.table}`,
    columns: input.columns.map((c) => ({ name: c.name, note: `note for ${c.name}` })),
  })),
  generateExamples: vi.fn(async () => []),
  filterSchemaByQuestion: vi.fn(async () => new Set<string>()),
  // Default: keep every candidate. Per-test overrides can model the LLM
  // rejecting noise.
  confirmJoins: vi.fn(async (candidates) => candidates),
  ...overrides,
});

beforeEach(() => {
  clearRshipsCache();
});

describe('estimateSchemaChars', () => {
  it('grows with column count', () => {
    const small = estimateSchemaChars([col('t', 'a')]);
    const big = estimateSchemaChars(Array.from({ length: 100 }, (_, i) => col(`t${i}`, 'col')));
    expect(big).toBeGreaterThan(small);
  });
});

describe('getRshipsNStructure', () => {
  const schema = [col('users', 'id'), col('orders', 'user_id'), col('orders', 'amount', 'NUMERIC')];
  const stats = new Map<string, ColumnMeta>();
  const rowCounts = new Map<string, number>();
  const dialects = new Map<string, string>([['db', 'duckdb']]);

  it('runs all stages and returns annotated tables + examples', async () => {
    const deps = baseDeps();
    const result = await getRshipsNStructure(
      schema, stats, rowCounts, dialects, deps,
      { datasetKey: 'd1', llmContext: {} },
    );

    expect(result.tables).toHaveLength(2); // users, orders
    expect(result.tables[0].tableNote).toMatch(/note for/);
    expect(deps.generateTableNotes).toHaveBeenCalledTimes(2);
    expect(deps.fetchTableSample).toHaveBeenCalledTimes(2);
  });

  it('skips the filter step when the schema fits the budget', async () => {
    const deps = baseDeps();
    await getRshipsNStructure(
      schema, stats, rowCounts, dialects, deps,
      { datasetKey: 'd1', llmContext: {}, maxChars: 100_000 },
    );
    expect(deps.filterSchemaByQuestion).not.toHaveBeenCalled();
  });

  it('runs the filter step when the schema exceeds the budget', async () => {
    const bigSchema: FlatColumn[] = Array.from({ length: 1000 }, (_, i) =>
      col(`huge_table_${i}`, 'col'),
    );
    const filterDeps = baseDeps({
      filterSchemaByQuestion: vi.fn(async () => new Set(['db.public.huge_table_0'])),
    });

    const result = await getRshipsNStructure(
      bigSchema, stats, rowCounts, dialects, filterDeps,
      { datasetKey: 'd2', userMessage: 'tell me about huge_table_0', llmContext: { originalMessage: 'q' }, maxChars: 1000 },
    );
    expect(filterDeps.filterSchemaByQuestion).toHaveBeenCalled();
    // Only the filtered table makes it through.
    expect(result.tables.map((t) => t.table)).toEqual(['huge_table_0']);
  });

  it('passes skipUserMessage=true to LLM stages in the unfiltered branch', async () => {
    const deps = baseDeps();
    await getRshipsNStructure(
      schema, stats, rowCounts, dialects, deps,
      { datasetKey: 'd3', llmContext: { originalMessage: 'leak' }, maxChars: 100_000 },
    );
    const noteCall = (deps.generateTableNotes as ReturnType<typeof vi.fn>).mock.calls[0];
    const noteOpts = noteCall[noteCall.length - 1];
    expect(noteOpts.skipUserMessage).toBe(true);

    const examplesCall = (deps.generateExamples as ReturnType<typeof vi.fn>).mock.calls[0];
    const examplesOpts = examplesCall[examplesCall.length - 1];
    expect(examplesOpts.skipUserMessage).toBe(true);
  });

  it('passes skipUserMessage=false in the filtered branch (cache key encodes question)', async () => {
    const bigSchema: FlatColumn[] = Array.from({ length: 1000 }, (_, i) =>
      col(`tbl_${i}`, 'col'),
    );
    const filterDeps = baseDeps({
      filterSchemaByQuestion: vi.fn(async () => new Set(['db.public.tbl_0'])),
    });
    await getRshipsNStructure(
      bigSchema, stats, rowCounts, dialects, filterDeps,
      { datasetKey: 'd4', userMessage: 'q', llmContext: { originalMessage: 'q' }, maxChars: 1000 },
    );
    const noteCall = (filterDeps.generateTableNotes as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(noteCall[noteCall.length - 1].skipUserMessage).toBe(false);
  });

  it('caches per datasetKey in unfiltered branch', async () => {
    const deps = baseDeps();
    await getRshipsNStructure(schema, stats, rowCounts, dialects, deps, {
      datasetKey: 'cached', llmContext: {}, maxChars: 100_000,
    });
    await getRshipsNStructure(schema, stats, rowCounts, dialects, deps, {
      datasetKey: 'cached', llmContext: {}, maxChars: 100_000,
    });
    // Second call must hit cache; no new work.
    expect(deps.generateTableNotes).toHaveBeenCalledTimes(2); // 2 tables, ONE call set total
  });

  it('uses distinct cache slots per (datasetKey, filtered tables) when filtering', async () => {
    const bigSchema: FlatColumn[] = Array.from({ length: 1000 }, (_, i) => col(`t_${i}`, 'col'));
    const filterDeps = baseDeps({
      filterSchemaByQuestion: vi
        .fn()
        .mockResolvedValueOnce(new Set(['db.public.t_0']))
        .mockResolvedValueOnce(new Set(['db.public.t_5'])),
    });

    await getRshipsNStructure(bigSchema, stats, rowCounts, dialects, filterDeps, {
      datasetKey: 'd', userMessage: 'about t_0', llmContext: {}, maxChars: 1000,
    });
    await getRshipsNStructure(bigSchema, stats, rowCounts, dialects, filterDeps, {
      datasetKey: 'd', userMessage: 'about t_5', llmContext: {}, maxChars: 1000,
    });
    expect(filterDeps.filterSchemaByQuestion).toHaveBeenCalledTimes(2);
    expect(filterDeps.generateTableNotes).toHaveBeenCalledTimes(2); // 1 table each
  });

  it('passes mechanically-verified joins through the LLM confirm step before notes/examples', async () => {
    // Three mechanically-found joins; the LLM stub keeps only the middle one.
    const fakeFindings = [
      { left: schema[0], right: schema[1], overlap: 0.5, kind: 'direct' as const },
      { left: schema[0], right: schema[2], overlap: 0.5, kind: 'direct' as const },
      { left: schema[1], right: schema[2], overlap: 0.5, kind: 'direct' as const },
    ];
    const confirmSpy = vi.fn<RshipsDeps['confirmJoins']>(async () => [fakeFindings[1]]);
    const deps = baseDeps({
      // Force a non-empty `discoverJoins` outcome by returning consistent samples.
      fetchSampleValues: vi.fn(async () => ['shared', 'shared', 'shared']),
      confirmJoins: confirmSpy,
    });

    await getRshipsNStructure(schema, stats, rowCounts, dialects, deps, {
      datasetKey: 'confirm-test', llmContext: {}, maxChars: 100_000,
    });

    expect(confirmSpy).toHaveBeenCalledOnce();
    // The LLM-confirmed set is what flows into examples (1 candidate → 1 seed).
    const examplesCall = (deps.generateExamples as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(examplesCall[1]).toHaveLength(1);
  });

  it('separates cache slots by cacheKey (DoubleCheck primary vs secondary)', async () => {
    const deps = baseDeps();
    await getRshipsNStructure(schema, stats, rowCounts, dialects, deps, {
      datasetKey: 'shared', cacheKey: 'agent-a', llmContext: {}, maxChars: 100_000,
    });
    await getRshipsNStructure(schema, stats, rowCounts, dialects, deps, {
      datasetKey: 'shared', cacheKey: 'agent-b', llmContext: {}, maxChars: 100_000,
    });
    // Different cacheKey → two separate computations.
    expect(deps.generateTableNotes).toHaveBeenCalledTimes(4); // 2 tables × 2 slots
  });

  it('dedupes concurrent calls with the same cache key (in-flight promise reuse)', async () => {
    const deps = baseDeps();
    const [r1, r2] = await Promise.all([
      getRshipsNStructure(schema, stats, rowCounts, dialects, deps, {
        datasetKey: 'race', llmContext: {}, maxChars: 100_000,
      }),
      getRshipsNStructure(schema, stats, rowCounts, dialects, deps, {
        datasetKey: 'race', llmContext: {}, maxChars: 100_000,
      }),
    ]);
    expect(r1).toBe(r2); // same object — single computation
    expect(deps.generateTableNotes).toHaveBeenCalledTimes(2); // 2 tables, ONCE
  });
});
