/**
 * Tests for confirm-joins.ts — LLM filtering of verified join candidates.
 *
 * The mechanical pipeline produces verified-overlap candidates (50+ for
 * a small dataset like yelp). The LLM step keeps only those that look
 * semantically real given column names + sample values + overlap stats.
 */

import { describe, it, expect, vi } from 'vitest';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import { confirmJoinsLLM, parseConfirmedIndices } from '../confirm-joins';
import type { JoinFinding } from '../joins';
import type { FlatColumn } from '../schema';

const fauxReg = registerFauxProvider({
  api: 'faux-confirm-joins-api',
  provider: 'faux-confirm-joins',
  models: [{ id: 'stub-confirm-joins' }],
});
const stubModel = fauxReg.getModel();

const col = (
  table: string,
  column: string,
  type = 'INTEGER',
  connection = 'db',
  schema = 'public',
): FlatColumn => ({ connection, schema, table, column, type });

const finding = (left: FlatColumn, right: FlatColumn, overlap = 0.5, kind: 'direct' | 'prefix-strip' = 'direct'): JoinFinding => ({
  left, right, overlap, kind,
});

describe('parseConfirmedIndices', () => {
  it('parses a JSON array of integers', () => {
    expect(parseConfirmedIndices('[0, 2, 5]')).toEqual(new Set([0, 2, 5]));
  });

  it('tolerates code-fence wrappers', () => {
    expect(parseConfirmedIndices('```json\n[1,3]\n```')).toEqual(new Set([1, 3]));
  });

  it('drops non-integer entries', () => {
    expect(parseConfirmedIndices('[0, "bad", 1.5, 2]')).toEqual(new Set([0, 2]));
  });

  it('returns empty set on malformed JSON', () => {
    expect(parseConfirmedIndices('not json')).toEqual(new Set());
  });

  it('returns empty set when input is not an array', () => {
    expect(parseConfirmedIndices('{"foo":1}')).toEqual(new Set());
  });
});

describe('confirmJoinsLLM', () => {
  it('returns the candidates whose indices the LLM keeps', async () => {
    const candidates: JoinFinding[] = [
      finding(col('a', 'id'), col('b', 'a_id')),     // index 0 — real FK
      finding(col('a', 'count'), col('b', 'count')), // index 1 — coincidence
      finding(col('a', 'name'), col('c', 'a_name')), // index 2 — real FK
    ];
    const samples = new Map<string, unknown[]>();
    const callLLM = vi.fn(async () => fauxAssistantMessage('[0, 2]'));

    const kept = await confirmJoinsLLM(candidates, samples, stubModel, callLLM, {});
    expect(kept).toHaveLength(2);
    expect(kept[0]).toBe(candidates[0]);
    expect(kept[1]).toBe(candidates[2]);
  });

  it('returns empty array when LLM returns empty array', async () => {
    const candidates: JoinFinding[] = [finding(col('a', 'x'), col('b', 'x'))];
    const callLLM = vi.fn(async () => fauxAssistantMessage('[]'));
    expect(await confirmJoinsLLM(candidates, new Map(), stubModel, callLLM, {})).toEqual([]);
  });

  it('keeps all candidates when LLM returns malformed JSON (fail-open)', async () => {
    const candidates: JoinFinding[] = [
      finding(col('a', 'x'), col('b', 'x')),
      finding(col('a', 'y'), col('b', 'y')),
    ];
    const callLLM = vi.fn(async () => fauxAssistantMessage('garbage'));
    // Better to over-include than to drop everything on a parse failure.
    const kept = await confirmJoinsLLM(candidates, new Map(), stubModel, callLLM, {});
    expect(kept).toHaveLength(2);
  });

  it('short-circuits when there are no candidates (no LLM call)', async () => {
    const callLLM = vi.fn(async () => fauxAssistantMessage('[]'));
    const kept = await confirmJoinsLLM([], new Map(), stubModel, callLLM, {});
    expect(kept).toEqual([]);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('includes sample values for each candidate in the prompt', async () => {
    let captured = '';
    const callLLM = vi.fn(async (_m, ctx) => {
      const first = ctx.messages[0]?.content;
      captured = typeof first === 'string' ? first : '';
      return fauxAssistantMessage('[0]');
    });
    const candidates: JoinFinding[] = [
      finding(col('users', 'id', 'VARCHAR'), col('orders', 'user_id', 'VARCHAR')),
    ];
    const samples = new Map<string, unknown[]>([
      ['db.public.users.id', ['u1', 'u2', 'u3']],
      ['db.public.orders.user_id', ['u1', 'u2', 'u3']],
    ]);

    await confirmJoinsLLM(candidates, samples, stubModel, callLLM, {});
    expect(captured).toContain('users');
    expect(captured).toContain('orders');
    expect(captured).toContain('"u1"');
  });

  it('respects skipUserMessage (strips originalMessage from prompt context)', async () => {
    let captured = '';
    const callLLM = vi.fn(async (_m, ctx) => {
      const first = ctx.messages[0]?.content;
      captured = typeof first === 'string' ? first : '';
      return fauxAssistantMessage('[]');
    });
    const candidates: JoinFinding[] = [finding(col('a', 'x'), col('b', 'x'))];

    await confirmJoinsLLM(
      candidates, new Map(), stubModel, callLLM,
      { contextDocs: 'docs', originalMessage: 'should-not-appear' },
      { skipUserMessage: true },
    );
    expect(captured).toContain('docs');
    expect(captured).not.toContain('should-not-appear');
  });
});
