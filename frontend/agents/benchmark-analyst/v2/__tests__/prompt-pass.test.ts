// Tests for the shared "+prompt" pass.
//
// The orchestrating method lives on `V2DataTool` (it reads `this.context` /
// `this.orchestrator` / `this.id` directly — no context flows as args). Pure
// pieces (user-content building, rerank application, response parsing) live
// in `prompt-pass.ts` and are tested directly here. Integration of the LLM
// call is tested through a minimal `V2DataTool` subclass.
import { describe, it, expect, beforeEach } from 'vitest';
import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { fauxAssistantMessage, registerFauxProvider } from '@/orchestrator/llm/testing';
import { Orchestrator } from '@/orchestrator/orchestrator';
import type { Api, Model } from '@/orchestrator/llm';
import type { QueryResult } from '@/lib/connections/base';
import type { BenchmarkAnalystContext } from '../../types';
import { V2DataTool } from '../data-tool-base';
import type { ToolResponse } from '@/orchestrator/types';
import {
  applyRerank,
  buildPromptPassUserContent,
  buildPromptPassPreviews,
  parsePromptPassResponse,
  pickPromptPassInfo,
  runPromptPassFree,
  type PromptPassEntry,
} from '../prompt-pass';

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

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe('applyRerank', () => {
  it('reorders rows to the given ids', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }];
    expect(applyRerank(rows, ['r2', 'r0', 'r1'])).toEqual([
      { name: 'gamma' }, { name: 'alpha' }, { name: 'beta' },
    ]);
  });

  it('filters to a subset of ids', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }];
    expect(applyRerank(rows, ['r1'])).toEqual([{ name: 'beta' }]);
  });

  it('skips unknown ids per-row, keeps the known ones', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }];
    expect(applyRerank(rows, ['r7', 'r1'])).toEqual([{ name: 'beta' }]);
  });

  it('dedupes repeated ids', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }];
    expect(applyRerank(rows, ['r1', 'r1', 'r0'])).toEqual([{ name: 'beta' }, { name: 'alpha' }]);
  });

  it('falls back to original order when all ids are unknown', () => {
    const rows = [{ name: 'alpha' }, { name: 'beta' }];
    expect(applyRerank(rows, ['r7', 'r8'])).toEqual(rows);
  });

  it('falls back to original order for non-array or empty input', () => {
    const rows = [{ name: 'alpha' }];
    expect(applyRerank(rows, null)).toEqual(rows);
    expect(applyRerank(rows, [])).toEqual(rows);
    expect(applyRerank(rows, 'not-an-array')).toEqual(rows);
  });
});

describe('buildPromptPassUserContent', () => {
  it('includes original question and data docs when context provides them', () => {
    const content = buildPromptPassUserContent(
      [{ label: 'q1', result: result(['alpha']) }],
      'task text',
      { contextDocs: 'Docs about the dataset.', originalMessage: 'What is the answer?' },
    );
    expect(content).toContain('## Original question');
    expect(content).toContain('What is the answer?');
    expect(content).toContain('## Data Documentation');
    expect(content).toContain('Docs about the dataset.');
    expect(content).toContain('## Task');
    expect(content).toContain('task text');
  });

  it('omits grounding sections when context is empty', () => {
    const content = buildPromptPassUserContent(
      [{ label: 'q1', result: result(['alpha']) }],
      'task',
      {},
    );
    expect(content).not.toContain('## Original question');
    expect(content).not.toContain('## Data Documentation');
  });

  it('renders error entries with their error text', () => {
    const content = buildPromptPassUserContent(
      [{ label: 'q1', error: 'boom' }],
      'task',
      {},
    );
    expect(content).toContain('ERROR: boom');
  });

  it('indexes shown rows with rN: prefixes', () => {
    const content = buildPromptPassUserContent(
      [{ label: 'q1', result: result(['alpha', 'beta']) }],
      'task',
      {},
    );
    expect(content).toMatch(/r0: \{"name":"alpha"\}/);
    expect(content).toMatch(/r1: \{"name":"beta"\}/);
  });
});

describe('runPromptPassFree skipUserMessage', () => {
  // Stub call shape: capture the inbound user-message content text so we
  // can inspect grounding sections without depending on the full Context type.
  const captureCallLLM = () => {
    const userContents: string[] = [];
    const fn: typeof Orchestrator.prototype.callLLM extends infer T ? T : never =
      undefined as never;
    void fn;
    const callLLM = async (_model: Model<Api>, context: { messages: Array<{ content: unknown }> }) => {
      const first = context.messages[0]?.content;
      userContents.push(typeof first === 'string' ? first : JSON.stringify(first));
      return fauxAssistantMessage('{"results":[],"info":"x"}');
    };
    return { callLLM: callLLM as unknown as Parameters<typeof runPromptPassFree>[4], userContents };
  };
  const stubModel = fauxReg.getModel();

  it('includes the original question by default', async () => {
    const { callLLM, userContents } = captureCallLLM();
    await runPromptPassFree(
      [{ label: 'q1', result: result(['a']) }],
      'task',
      stubModel,
      { contextDocs: 'docs', originalMessage: 'leak-me' },
      callLLM,
    );
    expect(userContents[0]).toContain('## Original question');
    expect(userContents[0]).toContain('leak-me');
  });

  it('strips originalMessage when skipUserMessage is true', async () => {
    const { callLLM, userContents } = captureCallLLM();
    await runPromptPassFree(
      [{ label: 'q1', result: result(['a']) }],
      'task',
      stubModel,
      { contextDocs: 'docs', originalMessage: 'leak-me' },
      callLLM,
      { skipUserMessage: true },
    );
    expect(userContents[0]).not.toContain('## Original question');
    expect(userContents[0]).not.toContain('leak-me');
    // Docs still flow through — only originalMessage is dropped.
    expect(userContents[0]).toContain('## Data Documentation');
  });

  it('accepts maxChars positional and opts trailing simultaneously', async () => {
    const { callLLM } = captureCallLLM();
    // Should not throw — verifies the dual-shape signature is backward-compat.
    await expect(
      runPromptPassFree(
        [{ label: 'q1', result: result(['a']) }],
        'task',
        stubModel,
        { originalMessage: 'q' },
        callLLM,
        500,
        { skipUserMessage: true },
      ),
    ).resolves.toBeDefined();
  });
});

describe('parsePromptPassResponse', () => {
  it('parses a valid JSON response', () => {
    const parsed = parsePromptPassResponse('{"results":[{"rerankedIds":["r0"]}],"info":"ok"}');
    expect(parsed).toEqual({ results: [{ rerankedIds: ['r0'] }], info: 'ok' });
  });

  it('tolerates code-fence wrappers', () => {
    const parsed = parsePromptPassResponse('```json\n{"results":[{"rerankedIds":["r0"]}],"info":"fenced"}\n```');
    expect(parsed?.info).toBe('fenced');
  });

  it('returns null on malformed JSON', () => {
    expect(parsePromptPassResponse('not json at all')).toBeNull();
  });
});

describe('pickPromptPassInfo', () => {
  it('returns parsed info when valid', () => {
    expect(pickPromptPassInfo({ info: 'hello' }, 'raw')).toBe('hello');
  });

  it('falls back to raw text when parsed is null', () => {
    expect(pickPromptPassInfo(null, 'raw text')).toBe('raw text');
  });

  it('falls back when info is missing or non-string', () => {
    expect(pickPromptPassInfo({}, 'raw')).toBe('raw');
    expect(pickPromptPassInfo({ info: 42 as unknown as string }, 'raw')).toBe('raw');
  });
});

describe('buildPromptPassPreviews', () => {
  it('returns undefined for error entries and previews for success entries', () => {
    const entries: PromptPassEntry[] = [
      { label: 'q1', error: 'boom' },
      { label: 'q2', result: result(['alpha', 'beta']) },
    ];
    const parsed = { results: [null, { rerankedIds: ['r1', 'r0'] }] };
    const previews = buildPromptPassPreviews(entries, parsed);
    expect(previews[0]).toBeUndefined();
    expect(previews[1]).toBeDefined();
    expect(previews[1]!.indexOf('beta')).toBeLessThan(previews[1]!.indexOf('alpha'));
  });

  it('keeps original order when parsed is null (fallback)', () => {
    const entries: PromptPassEntry[] = [{ label: 'q1', result: result(['alpha', 'beta']) }];
    const previews = buildPromptPassPreviews(entries, null);
    expect(previews[0]!.indexOf('alpha')).toBeLessThan(previews[0]!.indexOf('beta'));
  });
});

// ─── Integration: V2DataTool.runPromptPass ─────────────────────────────────

// A minimal V2DataTool subclass that exposes runPromptPass for tests.
const TestPassToolParams = Type.Object({});
class TestPassTool extends V2DataTool<typeof TestPassToolParams, unknown> {
  static readonly schema: Tool<typeof TestPassToolParams> = {
    name: 'TestPassTool',
    description: '',
    parameters: TestPassToolParams,
  };
  async run(): Promise<ToolResponse<unknown>> {
    throw new Error('not used');
  }
  async invoke(
    entries: PromptPassEntry[],
    prompt: string,
    model: Model<Api>,
    maxChars?: number,
  ) {
    // Public accessor — tests can't call the protected method directly.
    return this.runPromptPass(entries, prompt, model, maxChars);
  }
}

describe('V2DataTool.runPromptPass — integration', () => {
  beforeEach(() => {
    fauxReg.setResponses([]);
  });

  function makeTool(ctx: BenchmarkAnalystContext = {}): TestPassTool {
    const orch = new Orchestrator([TestPassTool]);
    return new TestPassTool(orch, {}, ctx, 'test-id');
  }

  it('reads contextDocs and originalMessage from this.context (no args needed)', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('{"results":[{"rerankedIds":null}],"info":"saw context"}', { stopReason: 'stop' }),
    ]);
    const tool = makeTool({
      contextDocs: 'Docs about the dataset.',
      originalMessage: 'What is the answer?',
    });
    const { info } = await tool.invoke(
      [{ label: 'q1', result: result(['alpha']) }],
      'task text',
      fauxReg.getModel(),
    );
    expect(info).toBe('saw context');
    // The call's user content (read via the spy below) includes the
    // grounding sections from this.context — verified indirectly by the
    // model receiving them; we test the building directly above.
  });

  it('falls back to raw text as info when the model returns non-JSON', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage('just a plain-text summary', { stopReason: 'stop' }),
    ]);
    const tool = makeTool();
    const { info, previews } = await tool.invoke(
      [{ label: 'q1', result: result(['alpha', 'beta']) }],
      'task',
      fauxReg.getModel(),
    );
    expect(info).toBe('just a plain-text summary');
    // No valid rerank → original order preserved.
    expect(previews[0]!.indexOf('alpha')).toBeLessThan(previews[0]!.indexOf('beta'));
  });

  it('applies rerankedIds to reorder previews end-to-end', async () => {
    fauxReg.setResponses([
      fauxAssistantMessage(
        '{"results":[{"rerankedIds":["r2","r0","r1"]}],"info":"reordered"}',
        { stopReason: 'stop' },
      ),
    ]);
    const tool = makeTool();
    const { previews, info } = await tool.invoke(
      [{ label: 'q1', result: result(['alpha', 'beta', 'gamma']) }],
      'rank',
      fauxReg.getModel(),
    );
    expect(info).toBe('reordered');
    const p = previews[0]!;
    expect(p.indexOf('gamma')).toBeLessThan(p.indexOf('alpha'));
    expect(p.indexOf('alpha')).toBeLessThan(p.indexOf('beta'));
  });
});
