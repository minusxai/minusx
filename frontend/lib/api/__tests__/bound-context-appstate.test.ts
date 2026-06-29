// Server-side defense: the chat ingestion must never let a pathologically large context (e.g. an
// 8 MB schema cache from a STALE client that predates the markup-shaping fix) reach the orchestrator
// — that's what OOM'd the box. boundContextAppState re-shapes ONLY an oversized context fileState
// (content stripped + markup re-derived), and leaves every normal appState completely untouched.
import { boundContextAppState } from '@/lib/api/compress-augmented';

const bigParentSchema = Array.from({ length: 4000 }, (_, i) => ({
  databaseName: `db${i}`,
  schemas: [{ schema: 's', tables: [{ table: `table_${i}`, columns: Array.from({ length: 20 }, (_, c) => ({ name: `col_${c}`, type: 'text' })) }] }],
}));

function bigContextAppState() {
  const content = {
    versions: [{ version: 1, whitelist: '*', docs: [{ content: '# Doc' }] }],
    published: { all: 1 },
    fullSchema: bigParentSchema,
    parentSchema: bigParentSchema,
  };
  // Simulate a stale client: an enormous markup blob with the raw schema cache inlined.
  const hugeMarkup = '<versions>...</versions>\n<fullSchema>' + 'x'.repeat(500_000) + '</fullSchema>';
  return { type: 'file', state: { fileState: { id: 1, type: 'context', content, markup: hugeMarkup }, references: [], queryResults: [] } };
}

describe('boundContextAppState', () => {
  it('re-shapes an oversized context (drops fullSchema, bounds the markup)', () => {
    const app: any = bigContextAppState();
    expect(app.state.fileState.markup.length).toBeGreaterThan(200_000); // precondition: pathological

    boundContextAppState(app);

    const fs = app.state.fileState;
    expect('fullSchema' in fs.content).toBe(false);          // content shaped
    expect(fs.markup.length).toBeLessThanOrEqual(200_000);   // markup bounded
    expect(fs.markup).not.toContain('<fullSchema>');         // re-derived from shaped content
  });

  it('leaves a normal (already-small) context appState untouched', () => {
    const markup = '<versions>\n  <item><whitelist>*</whitelist></item>\n</versions>';
    const app: any = { type: 'file', state: { fileState: { id: 2, type: 'context', content: { versions: [{ version: 1, whitelist: '*' }] }, markup }, references: [] } };
    boundContextAppState(app);
    expect(app.state.fileState.markup).toBe(markup); // unchanged — zero impact on the normal path
  });

  it('ignores non-context files and non-file appstates', () => {
    const q: any = { type: 'file', state: { fileState: { id: 3, type: 'question', content: { query: 'select 1' }, markup: 'x'.repeat(300_000) }, references: [] } };
    const before = q.state.fileState.markup;
    boundContextAppState(q);
    expect(q.state.fileState.markup).toBe(before); // questions are never touched
    expect(() => boundContextAppState({ type: 'explore', state: null } as any)).not.toThrow();
    expect(() => boundContextAppState(null as any)).not.toThrow();
  });
});
