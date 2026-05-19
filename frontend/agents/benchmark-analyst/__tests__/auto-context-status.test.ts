/**
 * AutoContext failures must surface in the benchmark row's persisted output
 * so the eval JSONL distinguishes "agent reasoning failed" from "AutoContext
 * silently failed and the agent ran blind on misleading static contextDocs".
 *
 * Pin the wiring: BenchmarkAnalystAgent records each `ensureAutoContext`
 * attempt's outcome onto `ctx.autoContextAttempts` (ok/failed/skipped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fauxAssistantMessage } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { BenchmarkAnalystAgent, fauxRegistration } from '../benchmark-analyst';
import type { BenchmarkAnalystContext } from '../types';
import * as autoContextModule from '../v2/auto-context/auto-context';

const REGISTRABLES = [BenchmarkAnalystAgent];

async function runOnce(ctx: BenchmarkAnalystContext): Promise<void> {
  fauxRegistration.setResponses([
    fauxAssistantMessage('TL;DR: stub', { stopReason: 'stop' }),
  ]);
  const orch = new Orchestrator(REGISTRABLES);
  const root = new BenchmarkAnalystAgent(orch, { userMessage: 'q' }, ctx);
  const stream = orch.run(root);
  for await (const _ev of stream) { /* drain */ }
  await stream.result();
}

describe('BenchmarkAnalystAgent — AutoContext outcome on ctx.autoContextAttempts', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('records status:ok when ensureAutoContext succeeds', async () => {
    vi.spyOn(autoContextModule, 'ensureAutoContext').mockImplementation(async () => { /* no-op success */ });
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'd1', contextDocs: 'x',
      connections: [{ name: 'c', dialect: 'sqlite', config: { file_path: '/x' } }],
    };
    await runOnce(ctx);
    expect(ctx.autoContextAttempts).toHaveLength(1);
    expect(ctx.autoContextAttempts![0].status).toBe('ok');
    expect(ctx.autoContextAttempts![0].durationMs).toBeGreaterThanOrEqual(0);
    expect(ctx.autoContextAttempts![0].reason).toBeUndefined();
  });

  it('records status:failed with the error message when ensureAutoContext throws', async () => {
    vi.spyOn(autoContextModule, 'ensureAutoContext').mockImplementation(async () => {
      throw new Error('catalog probe timed out');
    });
    const ctx: BenchmarkAnalystContext = {
      datasetKey: 'd1', contextDocs: 'x',
      connections: [{ name: 'c', dialect: 'sqlite', config: { file_path: '/x' } }],
    };
    // Suppress the expected stderr noise.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ });
    await runOnce(ctx);
    errSpy.mockRestore();
    expect(ctx.autoContextAttempts).toHaveLength(1);
    expect(ctx.autoContextAttempts![0].status).toBe('failed');
    expect(ctx.autoContextAttempts![0].reason).toContain('catalog probe timed out');
  });

  it('REGRESSION: without pre-init on the row ctx, sub-agent pushes do NOT propagate (the bug we are fixing)', async () => {
    vi.spyOn(autoContextModule, 'ensureAutoContext').mockImplementation(async () => { /* ok */ });
    // Row-level ctx: NOT pre-initialised (the broken pre-fix state).
    const rowCtx: BenchmarkAnalystContext = {
      datasetKey: 'd1', contextDocs: 'x',
      connections: [{ name: 'c', dialect: 'sqlite', config: { file_path: '/x' } }],
    };
    // Orchestrator-style shallow merge with an override.
    const subAgentCtx: BenchmarkAnalystContext = { ...rowCtx, catalogKey: 'agent-a' };
    await runOnce(subAgentCtx);
    // Sub-agent's lazy init created the array on ITS OWN object…
    expect(subAgentCtx.autoContextAttempts).toHaveLength(1);
    // …but the row's ctx never saw it. This is the silent-data-loss bug
    // that surfaced as `"summary": "none"` on every row of the actual
    // benchmark output. Runner's pre-init (added in the same commit)
    // closes this by sharing one array reference across all sub-agents.
    expect(rowCtx.autoContextAttempts).toBeUndefined();
  });

  it('sub-agent attempts propagate up when ctx.autoContextAttempts is pre-initialised on the row-level ctx (DoubleCheck shape)', async () => {
    vi.spyOn(autoContextModule, 'ensureAutoContext').mockImplementation(async () => { /* ok */ });
    // Row-level ctx: pre-initialised by the runner.
    const rowCtx: BenchmarkAnalystContext = {
      datasetKey: 'd1', contextDocs: 'x',
      connections: [{ name: 'c', dialect: 'sqlite', config: { file_path: '/x' } }],
      autoContextAttempts: [], // ← pre-init by runner so the array reference is shared
    };
    // Simulate the orchestrator's shallow-merge of a per-slot context
    // override (e.g. DoubleCheck setting `catalogKey: 'agent-a'`):
    //   const effectiveContext = { ...parent.context, ...ctxOverride };
    // The override creates a new top-level object but the array reference
    // is preserved — so a `push` inside the sub-agent must reach `rowCtx`.
    const subAgentCtx: BenchmarkAnalystContext = { ...rowCtx, catalogKey: 'agent-a' };
    await runOnce(subAgentCtx);
    expect(rowCtx.autoContextAttempts).toHaveLength(1);
    expect(rowCtx.autoContextAttempts![0].status).toBe('ok');
    // The sub-agent's ctx is a different object, but its array refers to
    // the same memory as the row's ctx — confirming the fix.
    expect(subAgentCtx.autoContextAttempts).toBe(rowCtx.autoContextAttempts);
  });

  it('records status:skipped when datasetKey is unset (production path)', async () => {
    const ensureSpy = vi.spyOn(autoContextModule, 'ensureAutoContext');
    const ctx: BenchmarkAnalystContext = {
      // No datasetKey — production path: agent must NOT invoke ensureAutoContext.
      contextDocs: 'x',
      connections: [{ name: 'c', dialect: 'sqlite', config: { file_path: '/x' } }],
    };
    await runOnce(ctx);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(ctx.autoContextAttempts).toHaveLength(1);
    expect(ctx.autoContextAttempts![0].status).toBe('skipped');
  });
});
