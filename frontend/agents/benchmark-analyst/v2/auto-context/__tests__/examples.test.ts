/**
 * Tests for examples.ts — LLM-proposed example queries that are
 * execution-validated before being included in the AutoContext block.
 *
 * Pure parsing is tested directly; the end-to-end flow uses mock LLM +
 * mock executor to keep the test hermetic.
 */

import { describe, it, expect, vi } from 'vitest';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import type { QueryResult } from '@/lib/connections/base';
import {
  parseExamplesResponse,
  generateExamples,
} from '../examples';

const fauxReg = registerFauxProvider({
  api: 'faux-examples-api',
  provider: 'faux-examples',
  models: [{ id: 'stub-examples' }],
});
const stubModel = fauxReg.getModel();

const qr = (rows: Record<string, unknown>[]): QueryResult => ({
  columns: Object.keys(rows[0] ?? { _: null }),
  types: Object.keys(rows[0] ?? { _: null }).map(() => 'TEXT'),
  rows,
  finalQuery: '<test>',
});

describe('parseExamplesResponse', () => {
  it('parses a well-formed array', () => {
    const out = parseExamplesResponse(JSON.stringify([
      { description: 'Join A to B', connection: 'main', query: 'SELECT * FROM A JOIN B' },
    ]));
    expect(out).toEqual([
      { description: 'Join A to B', connection: 'main', query: 'SELECT * FROM A JOIN B' },
    ]);
  });

  it('drops malformed entries (missing fields)', () => {
    const out = parseExamplesResponse(JSON.stringify([
      { description: 'good', connection: 'c', query: 'q' },
      { description: 'bad' }, // missing connection + query
      { connection: 'c', query: 'q' }, // missing description
    ]));
    expect(out).toEqual([{ description: 'good', connection: 'c', query: 'q' }]);
  });

  it('tolerates code-fence wrappers', () => {
    const out = parseExamplesResponse(
      '```json\n[{"description":"d","connection":"c","query":"q"}]\n```',
    );
    expect(out).toEqual([{ description: 'd', connection: 'c', query: 'q' }]);
  });

  it('returns null on malformed JSON', () => {
    expect(parseExamplesResponse('not json')).toBeNull();
  });

  it('returns empty array when array is empty', () => {
    expect(parseExamplesResponse('[]')).toEqual([]);
  });
});

describe('generateExamples', () => {
  it('returns executed examples with their result rows', async () => {
    const llm = vi.fn(async () =>
      fauxAssistantMessage(JSON.stringify([
        { description: 'd1', connection: 'main', query: 'SELECT 1' },
        { description: 'd2', connection: 'main', query: 'SELECT 2' },
      ])),
    );
    const execute = vi.fn(async (_conn: string, q: string) =>
      qr(q.includes('1') ? [{ x: 1 }] : [{ x: 2 }]),
    );

    const examples = await generateExamples(
      'schema summary', [], stubModel, llm, {}, execute,
    );
    expect(examples).toHaveLength(2);
    expect(examples[0]).toMatchObject({ description: 'd1', connection: 'main', query: 'SELECT 1' });
    expect(examples[0].rows).toEqual([{ x: 1 }]);
  });

  it('drops examples whose query errors', async () => {
    const llm = vi.fn(async () =>
      fauxAssistantMessage(JSON.stringify([
        { description: 'good', connection: 'main', query: 'SELECT good' },
        { description: 'bad',  connection: 'main', query: 'SELECT bad' },
      ])),
    );
    const execute = vi.fn(async (_conn: string, q: string) => {
      if (q.includes('bad')) throw new Error('syntax error');
      return qr([{ ok: 1 }]);
    });

    const examples = await generateExamples(
      'schema', [], stubModel, llm, {}, execute,
    );
    expect(examples.map((e) => e.description)).toEqual(['good']);
  });

  it('drops examples that return 0 rows (uninformative)', async () => {
    const llm = vi.fn(async () =>
      fauxAssistantMessage(JSON.stringify([
        { description: 'empty', connection: 'main', query: 'SELECT empty' },
        { description: 'has',  connection: 'main', query: 'SELECT has' },
      ])),
    );
    const execute = vi.fn(async (_conn: string, q: string) =>
      qr(q.includes('empty') ? [] : [{ ok: 1 }]),
    );

    const examples = await generateExamples(
      'schema', [], stubModel, llm, {}, execute,
    );
    expect(examples.map((e) => e.description)).toEqual(['has']);
  });

  it('caps output at maxExamples', async () => {
    const llm = vi.fn(async () =>
      fauxAssistantMessage(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({
        description: `d${i}`,
        connection: 'main',
        query: `SELECT ${i}`,
      })))),
    );
    const execute = vi.fn(async () => qr([{ x: 1 }]));

    const examples = await generateExamples(
      'schema', [], stubModel, llm, {}, execute, { maxExamples: 3 },
    );
    expect(examples).toHaveLength(3);
  });

  it('passes contextDocs and respects skipUserMessage', async () => {
    let captured = '';
    const llm = vi.fn(async (_m, ctx) => {
      const first = ctx.messages[0]?.content;
      captured = typeof first === 'string' ? first : '';
      return fauxAssistantMessage('[]');
    });
    const execute = vi.fn(async () => qr([]));

    await generateExamples(
      'schema',
      [],
      stubModel,
      llm,
      { contextDocs: 'docs!', originalMessage: 'leak-me' },
      execute,
      { skipUserMessage: true },
    );
    expect(captured).toContain('docs!');
    expect(captured).not.toContain('leak-me');
  });

  it('returns empty array when LLM returns malformed JSON', async () => {
    const llm = vi.fn(async () => fauxAssistantMessage('garbage'));
    const execute = vi.fn(async () => qr([{ x: 1 }]));

    const examples = await generateExamples('schema', [], stubModel, llm, {}, execute);
    expect(examples).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});
