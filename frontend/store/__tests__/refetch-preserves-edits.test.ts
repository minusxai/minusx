/**
 * Regression: a REFETCH of a file (readFiles/loadFiles → setFiles/setFile) must NOT destroy
 * unsaved local edits (persistableChanges / ephemeralChanges / metadataChanges).
 *
 * The observed bug: an agent EditFile staged a dashboard's assets+layout via setEdit
 * (persistableChanges), then a follow-up `readFiles([fileId])` refetched the SAME server version
 * and `dbFileToFileState` reset persistableChanges to {} — so the dashboard rendered 0 questions
 * and wasn't even in the dirty list, despite EditFile reporting success.
 *
 * The invariant this pins:
 *  - Refetch at the SAME server version  → preserve unsaved edits (a read must never lose work).
 *  - Save/publish (BUMPED server version) → clear edits (the draft's base moved to the server).
 */
import { configureStore } from '@reduxjs/toolkit';
import filesReducer, {
  setFiles, setFile, setEdit, setEphemeral, setMetadataEdit,
  selectMergedContent,
} from '@/store/filesSlice';

function makeStore() {
  return configureStore({ reducer: { files: filesReducer } });
}

const DASHBOARD = (id: number, version: number) => ({
  id, name: `dash-${id}`, path: `/org/dash-${id}`, type: 'dashboard' as const,
  version, last_edit_id: null,
  content: { description: '', assets: [], layout: { columns: 12, items: [] } },
  references: [], created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
});

const STAGED_EDITS = {
  description: 'Web event overview',
  assets: [{ type: 'question', id: 200 }, { type: 'question', id: 201 }],
  layout: { columns: 12, items: [{ id: 200, x: 0, y: 0, w: 6, h: 4 }, { id: 201, x: 6, y: 0, w: 6, h: 4 }] },
};

function persistableOf(store: ReturnType<typeof makeStore>, id: number) {
  return store.getState().files.files[id]?.persistableChanges;
}

describe('refetch preserves unsaved edits (setFiles / setFile)', () => {
  it('setFiles at the SAME version preserves staged persistableChanges (the dashboard-assembly bug)', () => {
    const store = makeStore();
    const id = 1044;
    store.dispatch(setFiles({ files: [DASHBOARD(id, 1)] }));
    store.dispatch(setEdit({ fileId: id, edits: STAGED_EDITS }));

    // Sanity: the edit is staged.
    expect(Object.keys(persistableOf(store, id) || {})).toHaveLength(3);

    // A follow-up refetch returns the SAME server version 1 (no server-side change).
    store.dispatch(setFiles({ files: [DASHBOARD(id, 1)] }));

    const merged = selectMergedContent(store.getState() as any, id) as any;
    expect(merged.assets).toHaveLength(2);
    expect(merged.layout.items).toHaveLength(2);
    expect(merged.description).toBe('Web event overview');
    expect(Object.keys(persistableOf(store, id) || {})).toHaveLength(3);
  });

  it('setFile at the SAME version preserves staged persistableChanges', () => {
    const store = makeStore();
    const id = 2044;
    store.dispatch(setFile({ file: DASHBOARD(id, 1) }));
    store.dispatch(setEdit({ fileId: id, edits: STAGED_EDITS }));

    store.dispatch(setFile({ file: DASHBOARD(id, 1) }));

    expect((selectMergedContent(store.getState() as any, id) as any).assets).toHaveLength(2);
  });

  it('a file loaded as a REFERENCE at the same version keeps its staged edits', () => {
    const store = makeStore();
    const refId = 300;
    store.dispatch(setFiles({ files: [DASHBOARD(refId, 1)] }));
    store.dispatch(setEdit({ fileId: refId, edits: { description: 'edited ref' } }));

    // Loading some OTHER file that lists refId among its references must not clobber the ref's edits.
    store.dispatch(setFile({ file: DASHBOARD(999, 1), references: [DASHBOARD(refId, 1)] }));

    expect((selectMergedContent(store.getState() as any, refId) as any).description).toBe('edited ref');
  });

  it('preserves ephemeralChanges on refetch too', () => {
    const store = makeStore();
    const id = 4044;
    store.dispatch(setFiles({ files: [DASHBOARD(id, 1)] }));
    store.dispatch(setEphemeral({ fileId: id, changes: { description: 'ephemeral' } as any }));

    store.dispatch(setFiles({ files: [DASHBOARD(id, 1)] }));

    expect((selectMergedContent(store.getState() as any, id) as any).description).toBe('ephemeral');
  });

  it('preserves staged metadata (rename) on refetch', () => {
    const store = makeStore();
    const id = 5044;
    store.dispatch(setFiles({ files: [DASHBOARD(id, 1)] }));
    store.dispatch(setMetadataEdit({ fileId: id, changes: { name: 'Renamed' } }));

    store.dispatch(setFiles({ files: [DASHBOARD(id, 1)] }));

    expect(store.getState().files.files[id]?.metadataChanges?.name).toBe('Renamed');
  });

  it('CLEARS staged edits when the server version ADVANCES (save/publish moved the base)', () => {
    const store = makeStore();
    const id = 3044;
    store.dispatch(setFiles({ files: [DASHBOARD(id, 1)] }));
    store.dispatch(setEdit({ fileId: id, edits: STAGED_EDITS }));

    // A save returns the persisted file with a BUMPED version — the draft's base moved on,
    // so the (now redundant) staged edits should be cleared.
    store.dispatch(setFile({ file: DASHBOARD(id, 2) }));

    expect(Object.keys(persistableOf(store, id) || {})).toHaveLength(0);
    expect((selectMergedContent(store.getState() as any, id) as any).assets).toHaveLength(0);
  });
});
