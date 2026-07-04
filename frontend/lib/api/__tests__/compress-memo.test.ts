/**
 * compressFileState memoization. selectAppState recomputes on EVERY files-map / query-results
 * change — which happens per debounced keystroke and per landing query result — and each
 * recompute rebuilt the file's markup (fileToMarkup) and rubric from scratch even when the FILE
 * ITSELF was untouched. FileState objects are identity-stable under immer for untouched files,
 * so the expensive derived parts must be cached by (fileState identity, refs identities).
 */
import { describe, it, expect } from 'vitest';
import { compressAugmentedFile } from '@/lib/api/compress-augmented';
import type { AugmentedFile, FileState } from '@/lib/types';

function questionFile(id: number, over: Partial<FileState> = {}): FileState {
  return {
    id,
    name: `Q${id}`,
    path: `/org/q${id}`,
    type: 'question',
    content: {
      description: '', query: 'SELECT 1 AS n', connection_name: 'duckdb',
      vizSettings: { type: 'table' }, parameters: [],
    },
    references: [],
    version: 1, last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    loading: false, saving: false, updatedAt: 0, loadError: null,
    persistableChanges: {}, ephemeralChanges: {}, metadataChanges: {},
    ...over,
  } as FileState;
}

function dashboardFile(id: number, refIds: number[]): FileState {
  return questionFile(id, {
    type: 'dashboard',
    content: {
      description: 'KPIs',
      assets: refIds.map((rid) => ({ type: 'question', id: rid })),
      layout: { columns: 12, items: refIds.map((rid, i) => ({ id: rid, x: 0, y: i * 4, w: 12, h: 4 })) },
    } as never,
    references: refIds,
  });
}

const augmented = (fileState: FileState, references: FileState[] = []): AugmentedFile =>
  ({ fileState, references, queryResults: [] } as AugmentedFile);

describe('compressFileState memoization', () => {
  it('returns IDENTITY-equal markup/content/rubric for the same fileState + refs identities', () => {
    const ref = questionFile(2);
    const dash = dashboardFile(1, [2]);

    const a = compressAugmentedFile(augmented(dash, [ref]));
    const b = compressAugmentedFile(augmented(dash, [ref]));

    expect(b.fileState.markup).toBe(a.fileState.markup);   // string identity — not re-derived
    expect(b.fileState.content).toBe(a.fileState.content); // cached agentContent reused
    expect(b.fileState.rubric).toBe(a.fileState.rubric);
  });

  it('recomputes when the fileState identity changes (the file was actually edited)', () => {
    const dash = dashboardFile(1, []);
    const a = compressAugmentedFile(augmented(dash));

    const edited = { ...dash, persistableChanges: { description: 'now edited' } } as FileState;
    const b = compressAugmentedFile(augmented(edited));

    expect(b.fileState.markup).not.toBe(a.fileState.markup);
    expect(b.fileState.markup).toContain('now edited');
  });

  it('recomputes when a ref identity changes (rubric depends on refs viz types)', () => {
    const ref = questionFile(2);
    const dash = dashboardFile(1, [2]);
    const a = compressAugmentedFile(augmented(dash, [ref]));

    const changedRef = {
      ...ref,
      content: { ...(ref.content as object), vizSettings: { type: 'bar', xCols: ['n'], yCols: ['n'] } },
    } as FileState;
    const b = compressAugmentedFile(augmented(dash, [changedRef]));

    // The dashboard itself is unchanged, but the refs input to the rubric changed — must not
    // serve the stale cached rubric.
    expect(b.fileState.rubric).not.toBe(a.fileState.rubric);
  });

  it('does not let one file poison another (cache is per fileState object)', () => {
    const d1 = dashboardFile(1, []);
    const d2 = dashboardFile(9, []);
    const a = compressAugmentedFile(augmented(d1));
    const b = compressAugmentedFile(augmented(d2));
    expect(a.fileState.id).toBe(1);
    expect(b.fileState.id).toBe(9);
    // Distinct source objects → distinct cached content objects (object identity is meaningful here;
    // markup STRINGS can be value-equal across files, so they can't distinguish cache entries).
    expect(b.fileState.content).not.toBe(a.fileState.content);
  });
});
