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

  it('drops serialised-empty schemaSource/sqlExecutor (functions cannot survive JSON)', () => {
    const log: ConversationLog = [
      {
        type: 'toolCall',
        id: 'r1',
        name: 'BenchmarkAnalystAgent',
        arguments: { userMessage: 'q' },
        context: { connections: [], schemaSource: {}, sqlExecutor: {} },
        parent_id: null,
      },
    ] as unknown as ConversationLog;
    const ctx = buildBenchmarkContextFromSavedLog(log);
    expect(ctx.schemaSource).toBeUndefined();
    expect(ctx.sqlExecutor).toBeUndefined();
  });

  it('returns an empty context when the log has no root', () => {
    expect(buildBenchmarkContextFromSavedLog([] as unknown as ConversationLog)).toEqual({});
  });
});
