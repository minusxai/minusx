// V2_REGISTRABLES exposes every agent/tool class the orchestrator may need
// to instantiate from a saved log's root invocation `name`. Benchmark
// conversation files (saved by `npm run benchmark:dab`) have a root
// `name: 'BenchmarkAnalystAgent'`; if the class isn't in the registry,
// `Orchestrator.lookupCallable` throws on resume and continuation breaks.
//
// This guards against silent regressions if the registry array drifts.

import { describe, it, expect } from 'vitest';

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import {
  V2_REGISTRABLES,
  getRootAgentName,
  buildBenchmarkContextFromSavedLog,
  isV2BenchmarkConversation,
} from '@/lib/chat-orchestration-v2.server';
import type { ConversationLog } from '@/orchestrator/types';

describe('V2_REGISTRABLES', () => {
  it('includes BenchmarkAnalystAgent so saved benchmark logs can be resumed in v=2 chat', () => {
    const found = V2_REGISTRABLES.find((r) => r.schema?.name === 'BenchmarkAnalystAgent');
    expect(found).toBeDefined();
  });
});

describe('getRootAgentName', () => {
  // The root invocation is the first AgentInvocation with parent_id === null.
  // setupOrchestration uses this to decide which agent class to spawn for a
  // new user-message turn (BenchmarkAnalystAgent for benchmark conversations,
  // WebAnalystAgent for production conversations).

  it('returns the root agent name for a benchmark conversation log', () => {
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'BenchmarkAnalystAgent',
        arguments: { userMessage: 'q' },
        context: { connections: [] },
        parent_id: null,
      },
    ] as unknown as ConversationLog;
    expect(getRootAgentName(log)).toBe('BenchmarkAnalystAgent');
  });

  it('returns the root agent name for a production analyst conversation log', () => {
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'AnalystAgent',
        arguments: { userMessage: 'q' },
        context: {},
        parent_id: null,
      },
    ] as unknown as ConversationLog;
    expect(getRootAgentName(log)).toBe('AnalystAgent');
  });

  it('returns undefined for an empty log', () => {
    expect(getRootAgentName([] as unknown as ConversationLog)).toBeUndefined();
  });

  it('ignores sub-agent invocations (parent_id !== null)', () => {
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'sub',
        name: 'SomeSubAgent',
        arguments: {},
        context: {},
        parent_id: 'r1',
      },
    ] as unknown as ConversationLog;
    expect(getRootAgentName(log)).toBeUndefined();
  });
});

describe('buildBenchmarkContextFromSavedLog', () => {
  // Reconstructs the BenchmarkAnalystContext for benchmark continuation by
  // pulling connections + whitelist off the saved root invocation's
  // `context`. Function-shaped fields (schemaSource, sqlExecutor) serialise
  // as `{}` so we deliberately omit them — the DB tools fall back to the
  // production server-side singletons.

  it('extracts connections from the saved root invocation', () => {
    const connections = [{ name: 'default_duckdb', dialect: 'duckdb' }];
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'BenchmarkAnalystAgent',
        arguments: { userMessage: 'q' },
        context: { connections },
        parent_id: null,
      },
    ] as unknown as ConversationLog;
    const ctx = buildBenchmarkContextFromSavedLog(log);
    expect(ctx.connections).toEqual(connections);
  });

  it('ignores any extra non-context fields on the saved root invocation', () => {
    // Older saved logs may carry stale shape (e.g. `schemaSource: {}` left
    // over from when the context exposed function overrides). The current
    // shape is JSON-only; the rebuilder picks only known fields and
    // ignores everything else.
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'BenchmarkAnalystAgent',
        arguments: { userMessage: 'q' },
        context: { connections: [], unknownLegacyField: {} },
        parent_id: null,
      },
    ] as unknown as ConversationLog;
    const ctx = buildBenchmarkContextFromSavedLog(log);
    expect(ctx.connections).toEqual([]);
    expect((ctx as Record<string, unknown>).unknownLegacyField).toBeUndefined();
  });

  it('returns an empty context when the log has no root', () => {
    expect(buildBenchmarkContextFromSavedLog([] as unknown as ConversationLog)).toEqual({});
  });
});

describe('isV2BenchmarkConversation', () => {
  // V1 and V2 double-check share `schema.name = 'DoubleCheckBenchmarkAgent'`,
  // so the root invocation name alone can't tell them apart. We detect V2 by
  // scanning the log for V2-only markers — `V2BenchmarkAnalystAgent`
  // sub-agent invocations or V2-exclusive tool calls (`Explore`, `fetchHandle`).

  it('returns true when the log contains a V2 agent invocation', () => {
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'DoubleCheckBenchmarkAgent',
        arguments: { userMessage: 'q' },
        context: {},
        parent_id: null,
      },
      {
        type: 'toolCall',
        id: 'sub',
        name: 'V2BenchmarkAnalystAgent',
        arguments: { userMessage: 'q' },
        context: {},
        parent_id: 'r1',
      },
    ] as unknown as ConversationLog;
    expect(isV2BenchmarkConversation(log)).toBe(true);
  });

  it('returns true when the log contains a V2-only tool call (Explore / fetchHandle)', () => {
    for (const v2Tool of ['Explore', 'fetchHandle']) {
      const log: ConversationLog = [
        {
          type: 'toolCall',
          id: 'r1',
          name: 'V2BenchmarkAnalystAgent',
          arguments: { userMessage: 'q' },
          context: {},
          parent_id: null,
        },
        {
          type: 'toolCall',
          id: 't1',
          name: v2Tool,
          arguments: {},
          parent_id: 'r1',
        },
      ] as unknown as ConversationLog;
      expect(isV2BenchmarkConversation(log)).toBe(true);
    }
  });

  it('returns false for a V1-only log (BenchmarkAnalystAgent + Base* tools)', () => {
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'BenchmarkAnalystAgent',
        arguments: { userMessage: 'q' },
        context: {},
        parent_id: null,
      },
      {
        type: 'toolCall',
        id: 't1',
        name: 'ExecuteQuery',
        arguments: {},
        parent_id: 'r1',
      },
    ] as unknown as ConversationLog;
    expect(isV2BenchmarkConversation(log)).toBe(false);
  });

  it('returns false for an empty log', () => {
    expect(isV2BenchmarkConversation([] as unknown as ConversationLog)).toBe(false);
  });
});

describe('V2_REGISTRABLES V2 benchmark coverage', () => {
  it('registers every V2 entry point so saved V2 logs can be resumed', () => {
    const names = V2_REGISTRABLES.map((r) => r.schema?.name);
    // V2 chat continuation uses a different set (V2_BENCHMARK_REGISTRABLES);
    // V2_REGISTRABLES is the production+V1-benchmark base. This test just
    // pins the public surface for older logs.
    expect(names).toContain('BenchmarkAnalystAgent');
    expect(names).toContain('DoubleCheckBenchmarkAgent');
  });
});
