/**
 * The agent reads a file's `markup` projection, not its JSON `content` — the two are
 * duplicate context. At the LLM serialization boundary we strip `content` (keeping
 * `markup` + everything else). These helpers do that for ReadFiles results and AppState.
 */
import { describe, it, expect } from 'vitest';
import { omitFileStateContent, stripAugmentedContentForLlm } from '@/lib/chat/compress-augmented';
import { appStateForLlm, takeAppStateMarkup } from '@/lib/appState';
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

describe('takeAppStateMarkup — JSX pulled out of the AppState JSON into raw blocks', () => {
  it('pulls markup from the file state, its references, AND the open-modal file', () => {
    const { value, blocks } = takeAppStateMarkup({
      type: 'file',
      state: augmented(),
      ui: { openModal: { type: 'question', fileId: 9, fileState: fs(9) } },
    });
    if (value.type !== 'file') throw new Error('expected file app state');
    // No markup left anywhere in the JSON-serializable value.
    expect(value.state.fileState).not.toHaveProperty('markup');
    expect(value.state.references[0]).not.toHaveProperty('markup');
    expect(value.ui?.openModal?.fileState).not.toHaveProperty('markup');
    expect(JSON.stringify(value)).not.toContain('<query>');
    // Blocks carry the markup for the primary, the reference, and the modal file.
    expect(blocks.map((b) => b.fileId).sort()).toEqual([1, 2, 9]);
    expect(blocks.every((b) => b.markup === '<query>SELECT 1</query>')).toBe(true);
  });

  it('returns no blocks for folder/explore app-states', () => {
    expect(takeAppStateMarkup({ type: 'folder', state: { files: [], loading: false, error: null } }).blocks).toEqual([]);
    expect(takeAppStateMarkup({ type: 'explore', state: null }).blocks).toEqual([]);
  });
});
