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
