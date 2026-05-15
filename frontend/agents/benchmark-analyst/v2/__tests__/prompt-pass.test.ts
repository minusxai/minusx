// Tests for the shared "+prompt" pass used by SearchDBSchema / ExecuteQuery /
// Explore. The prompt model both (a) re-ranks/filters each preview's rows —
// selecting from the rows it was *given* — and (b) writes one `info` summary.
import { describe, it, expect, beforeEach } from 'vitest';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { QueryResult } from '@/lib/connections/base';
import { runPromptPass, type PromptPassEntry } from '../prompt-pass';

const fauxReg = registerFauxProvider({
  api: 'faux-prompt-pass-api',
  provider: 'faux-prompt-pass',
  models: [{ id: 'stub-prompt-pass' }],
});

const result = (names: string[]): QueryResult => ({
  columns: ['name'],
  types: ['VARCHAR'],
  rows: names.map((name) => ({ name })),
  finalQuery: '',
});

const run = (entries: PromptPassEntry[]) =>
  runPromptPass(entries, 'rank by relevance', fauxReg.getModel(), new Orchestrator([]), 'test-id');

describe('runPromptPass', () => {
  beforeEach(() => {
    fauxReg.setResponses([]);
  });

  it('re-ranks a preview when the model returns valid rerankedIndices', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage(
        '{"results":[{"rerankedIndices":[2,0,1]}],"info":"reordered by relevance"}',
        { stopReason: 'stop' },
      ),
    ]);

    const { previews, info } = await run([{ label: 'q1', result: result(['alpha', 'beta', 'gamma']) }]);

    expect(info).toBe('reordered by relevance');
    // Preview rows must now be in [gamma, alpha, beta] order.
    const p = previews[0]!;
    expect(p.indexOf('gamma')).toBeLessThan(p.indexOf('alpha'));
    expect(p.indexOf('alpha')).toBeLessThan(p.indexOf('beta'));
  });

  it('filters a preview down to a subset of indices', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('{"results":[{"rerankedIndices":[1]}],"info":"only beta"}', { stopReason: 'stop' }),
    ]);

    const { previews } = await run([{ label: 'q1', result: result(['alpha', 'beta', 'gamma']) }]);

    expect(previews[0]).toContain('beta');
    expect(previews[0]).not.toContain('alpha');
    expect(previews[0]).not.toContain('gamma');
  });

  it('keeps original order when rerankedIndices are invalid (out of range)', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('{"results":[{"rerankedIndices":[7,8]}],"info":"x"}', { stopReason: 'stop' }),
    ]);

    const { previews } = await run([{ label: 'q1', result: result(['alpha', 'beta']) }]);

    const p = previews[0]!;
    expect(p.indexOf('alpha')).toBeLessThan(p.indexOf('beta'));
  });

  it('keeps original order and uses raw text as info when the model returns non-JSON', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('just a plain-text summary, no json', { stopReason: 'stop' }),
    ]);

    const { previews, info } = await run([{ label: 'q1', result: result(['alpha', 'beta']) }]);

    expect(info).toBe('just a plain-text summary, no json');
    const p = previews[0]!;
    expect(p.indexOf('alpha')).toBeLessThan(p.indexOf('beta'));
  });

  it('tolerates ```json code fences around the response', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage(
        '```json\n{"results":[{"rerankedIndices":[1,0]}],"info":"fenced"}\n```',
        { stopReason: 'stop' },
      ),
    ]);

    const { previews, info } = await run([{ label: 'q1', result: result(['alpha', 'beta']) }]);

    expect(info).toBe('fenced');
    expect(previews[0]!.indexOf('beta')).toBeLessThan(previews[0]!.indexOf('alpha'));
  });

  it('returns undefined preview for error entries and still summarizes the rest', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage(
        '{"results":[null,{"rerankedIndices":[0]}],"info":"one ok one failed"}',
        { stopReason: 'stop' },
      ),
    ]);

    const { previews, info } = await run([
      { label: 'q1', error: 'boom' },
      { label: 'q2', result: result(['alpha']) },
    ]);

    expect(previews[0]).toBeUndefined();
    expect(previews[1]).toContain('alpha');
    expect(info).toBe('one ok one failed');
  });
});
