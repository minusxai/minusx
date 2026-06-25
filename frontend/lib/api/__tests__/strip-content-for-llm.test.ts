/**
 * The agent reads a file's `markup` projection, not its JSON `content` — the two are
 * duplicate context. At the LLM serialization boundary we strip `content` (keeping
 * `markup` + everything else). These helpers do that for ReadFiles results and AppState.
 */
import { describe, it, expect } from 'vitest';
import { omitFileStateContent, stripAugmentedContentForLlm } from '@/lib/api/compress-augmented';
import { appStateForLlm } from '@/lib/appState';
import type { CompressedAugmentedFile, CompressedFileState } from '@/lib/types';

function fs(id: number): CompressedFileState {
  return {
    id,
    name: `f${id}`,
    path: `/org/f${id}`,
    type: 'question',
    isDirty: false,
    queryResultId: `qr${id}`,
    content: { query: 'SELECT 1', connection_name: '', vizSettings: { type: 'table' } } as CompressedFileState['content'],
    markup: '<query>SELECT 1</query>',
  };
}

function augmented(): CompressedAugmentedFile {
  return { fileState: fs(1), references: [fs(2)], queryResults: [] };
}

describe('strip content for LLM', () => {
  it('omitFileStateContent drops content but keeps markup + metadata', () => {
    const out = omitFileStateContent(fs(1));
    expect(out.content).toBeUndefined();
    expect(out.markup).toBe('<query>SELECT 1</query>');
    expect(out.id).toBe(1);
    expect(out.queryResultId).toBe('qr1');
  });

  it('stripAugmentedContentForLlm strips primary + references, keeps queryResults', () => {
    const out = stripAugmentedContentForLlm(augmented());
    expect(out.fileState.content).toBeUndefined();
    expect(out.fileState.markup).toBeDefined();
    expect(out.references[0].content).toBeUndefined();
    expect(out.references[0].markup).toBeDefined();
    expect(out.queryResults).toEqual([]);
  });

  it('appStateForLlm strips content from a file app-state and its open-modal file', () => {
    const out = appStateForLlm({
      type: 'file',
      state: augmented(),
      ui: { openModal: { type: 'question', fileId: 9, fileState: fs(9) } },
    });
    if (out.type !== 'file') throw new Error('expected file app state');
    expect(out.state.fileState.content).toBeUndefined();
    expect(out.state.fileState.markup).toBeDefined();
    expect(out.ui?.openModal?.fileState?.content).toBeUndefined();
    expect(out.ui?.openModal?.fileState?.markup).toBeDefined();
  });

  it('appStateForLlm leaves folder/explore app-states unchanged', () => {
    const folder = appStateForLlm({ type: 'folder', state: { files: [], loading: false, error: null } });
    expect(folder.type).toBe('folder');
    const explore = appStateForLlm({ type: 'explore', state: null });
    expect(explore.type).toBe('explore');
  });
});
