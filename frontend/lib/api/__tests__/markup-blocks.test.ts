// markup-blocks pulls the JSX `markup` OUT of the LLM-facing JSON (app state / ReadFiles /
// EditFile) and renders it as a separate RAW <file_markup> block — so the agent reads real
// JSX with real newlines, never an escaped JSON string value.
import { describe, it, expect } from 'vitest';
import type { CompressedAugmentedFile, CompressedFileState } from '@/lib/types';
import {
  renderMarkupBlock,
  takeFileStateMarkup,
  takeAugmentedMarkup,
  takeFilesMarkup,
} from '../markup-blocks';

const fs = (over: Partial<CompressedFileState> = {}): CompressedFileState => ({
  id: 1, name: 'Q', path: '/org/Q', type: 'question', isDirty: false,
  markup: '<query>\nSELECT 1\n</query>', ...over,
} as CompressedFileState);

describe('renderMarkupBlock', () => {
  it('emits a labeled <file_markup> block with RAW newlines (not escaped)', () => {
    const out = renderMarkupBlock({ fileId: 7, type: 'question', markup: '<a>\n<b/>\n</a>' });
    expect(out).toBe('<file_markup file_id="7" type="question">\n<a>\n<b/>\n</a>\n</file_markup>');
    expect(out).toContain('\n');      // a real newline char
    expect(out).not.toContain('\\n'); // never the escaped sequence
  });

  it('omits absent attributes', () => {
    expect(renderMarkupBlock({ markup: 'x' })).toBe('<file_markup>\nx\n</file_markup>');
  });
});

describe('takeFileStateMarkup', () => {
  it('removes markup from the fileState and returns it as a block', () => {
    const { fileState, block } = takeFileStateMarkup(fs({ id: 5, type: 'question', markup: '<m/>' }));
    expect(fileState).not.toHaveProperty('markup');
    expect(block).toEqual({ fileId: 5, type: 'question', markup: '<m/>' });
  });

  it('returns block=null when there is no markup', () => {
    const { block } = takeFileStateMarkup(fs({ markup: undefined }));
    expect(block).toBeNull();
  });

  it('handles undefined input', () => {
    expect(takeFileStateMarkup(undefined)).toEqual({ fileState: undefined, block: null });
  });
});

describe('takeAugmentedMarkup', () => {
  it('pulls markup from the primary fileState AND every reference, leaving no JSX in the JSON', () => {
    const aug: CompressedAugmentedFile = {
      fileState: fs({ id: 1, markup: '<primary/>' }),
      references: [fs({ id: 2, markup: '<ref2/>' }), fs({ id: 3, markup: '<ref3/>' })],
      queryResults: [],
    };
    const { value, blocks } = takeAugmentedMarkup(aug);
    expect(value.fileState).not.toHaveProperty('markup');
    expect(value.references.every((r) => !('markup' in r))).toBe(true);
    expect(blocks.map((b) => b.fileId)).toEqual([1, 2, 3]);
    // The serialized JSON must contain none of the markup strings.
    expect(JSON.stringify(value)).not.toContain('<primary/>');
    expect(JSON.stringify(value)).not.toContain('<ref2/>');
  });
});

describe('takeFilesMarkup', () => {
  it('flattens blocks across all files and strips markup from each', () => {
    const mk = (id: number): CompressedAugmentedFile => ({
      fileState: fs({ id, markup: `<f${id}/>` }), references: [], queryResults: [],
    });
    const { files, blocks } = takeFilesMarkup([mk(1), mk(2)]);
    expect(blocks.map((b) => b.fileId)).toEqual([1, 2]);
    expect(JSON.stringify(files)).not.toContain('<f1/>');
    expect(JSON.stringify(files)).not.toContain('<f2/>');
  });
});
