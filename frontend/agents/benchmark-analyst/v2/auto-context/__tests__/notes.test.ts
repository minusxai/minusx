/**
 * Tests for notes.ts — LLM-grounded per-table notes.
 *
 * We mock the `callLLM` callback to control the structured-JSON
 * response. The LLM should be invoked once per table with the table's
 * samples + stats + joins in the prompt; output is validated against the
 * schema (columns not in schema are dropped from the output).
 */

import { describe, it, expect, vi } from 'vitest';
import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai';
import { generateTableNotes, type TableNoteInput } from '../notes';

const fauxReg = registerFauxProvider({
  api: 'faux-notes-api',
  provider: 'faux-notes',
  models: [{ id: 'stub-notes' }],
});
const stubModel = fauxReg.getModel();

const sampleInput = (overrides: Partial<TableNoteInput> = {}): TableNoteInput => ({
  connection: 'db',
  schema: 'public',
  table: 'users',
  columns: [
    { name: 'id', type: 'INTEGER' },
    { name: 'email', type: 'VARCHAR' },
  ],
  samples: [{ id: 1, email: 'a@x.com' }, { id: 2, email: 'b@x.com' }],
  joinsToTable: [],
  ...overrides,
});

describe('generateTableNotes', () => {
  it('returns LLM-provided table note and per-column notes', async () => {
    const fn = vi.fn(async () =>
      fauxAssistantMessage(
        JSON.stringify({
          table_note: 'A users table.',
          columns: [
            { name: 'id', note: 'Primary key.' },
            { name: 'email', note: 'Login identifier.' },
          ],
        }),
      ),
    );

    const out = await generateTableNotes(sampleInput(), stubModel, fn, {});
    expect(out.table_note).toBe('A users table.');
    expect(out.columns).toEqual([
      { name: 'id', note: 'Primary key.' },
      { name: 'email', note: 'Login identifier.' },
    ]);
  });

  it('drops column notes for columns not in the schema (LLM hallucination guard)', async () => {
    const fn = vi.fn(async () =>
      fauxAssistantMessage(
        JSON.stringify({
          table_note: 'tn',
          columns: [
            { name: 'id', note: 'real' },
            { name: 'phantom', note: 'fabricated' },
            { name: 'email', note: 'real' },
          ],
        }),
      ),
    );

    const out = await generateTableNotes(sampleInput(), stubModel, fn, {});
    expect(out.columns.map((c) => c.name)).toEqual(['id', 'email']);
    expect(out.columns.find((c) => c.name === 'phantom')).toBeUndefined();
  });

  it('falls back to empty notes when the LLM returns malformed JSON', async () => {
    const fn = vi.fn(async () => fauxAssistantMessage('this is not json'));
    const out = await generateTableNotes(sampleInput(), stubModel, fn, {});
    expect(out.table_note).toBe('');
    expect(out.columns).toEqual([
      { name: 'id', note: '' },
      { name: 'email', note: '' },
    ]);
  });

  it('includes the table\'s samples and joins in the user prompt', async () => {
    let captured = '';
    const fn = vi.fn(async (_model, ctx) => {
      const first = ctx.messages[0]?.content;
      captured = typeof first === 'string' ? first : '';
      return fauxAssistantMessage('{"table_note":"x","columns":[]}');
    });

    await generateTableNotes(
      sampleInput({
        joinsToTable: [
          { fromColumn: 'id', toTable: 'orders', toColumn: 'user_id', kind: 'direct', overlap: 0.9 },
        ],
      }),
      stubModel,
      fn,
      {},
    );

    expect(captured).toContain('users');
    expect(captured).toContain('Sample rows');
    expect(captured).toContain('orders'); // join surface
    expect(captured).toContain('user_id');
  });

  it('passes contextDocs and respects skipUserMessage', async () => {
    let captured = '';
    const fn = vi.fn(async (_model, ctx) => {
      const first = ctx.messages[0]?.content;
      captured = typeof first === 'string' ? first : '';
      return fauxAssistantMessage('{"table_note":"x","columns":[]}');
    });

    // With skipUserMessage=true and originalMessage present, the question
    // must NOT appear (cache-safe path).
    await generateTableNotes(
      sampleInput(),
      stubModel,
      fn,
      { contextDocs: 'docs about dataset', originalMessage: 'should-not-appear' },
      { skipUserMessage: true },
    );
    expect(captured).toContain('docs about dataset');
    expect(captured).not.toContain('should-not-appear');
  });

  it('strips code-fence wrappers around JSON responses', async () => {
    const fn = vi.fn(async () =>
      fauxAssistantMessage('```json\n{"table_note":"tn","columns":[{"name":"id","note":"k"}]}\n```'),
    );
    const out = await generateTableNotes(sampleInput(), stubModel, fn, {});
    expect(out.table_note).toBe('tn');
    expect(out.columns[0].note).toBe('k');
  });
});
