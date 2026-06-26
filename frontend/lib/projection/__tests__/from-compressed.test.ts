// Adapter: existing CompressedAugmentedFile → rich AugmentedFiles. Faithful mapping (no stripping):
// markup → content facet, flat query-result list re-attached to the file it belongs to by hash,
// CompressedQueryResult.data → query data facet (summary always; data only when rows exist).
import { describe, it, expect } from 'vitest';
import { compressedToAugmentedFiles } from '../from-compressed';
import type { CompressedAugmentedFile } from '@/lib/types';

const Q1: CompressedAugmentedFile = {
  fileState: { id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, queryResultId: 'h1', markup: '<question id="1"/>' },
  references: [],
  queryResults: [
    { columns: ['a', 'b'], types: ['number', 'text'], data: '| a | b |\n| --- | --- |\n| 1 | x |\n', totalRows: 1, shownRows: 1, truncated: false, id: 'h1', finalQuery: 'SELECT 1' },
  ],
};

describe('compressedToAugmentedFiles', () => {
  it('maps file metadata into the data facet and markup into the content facet', () => {
    const out = compressedToAugmentedFiles(Q1);
    expect(out.file.data).toEqual({ id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, queryResultId: 'h1' });
    expect(out.file.content).toEqual({ markup: '<question id="1"/>' });
  });

  it('re-attaches the flat query result to the file it belongs to (by hash), keeping summary + data', () => {
    const out = compressedToAugmentedFiles(Q1);
    expect(out.file.queryResults).toEqual([{
      queryResultId: 'h1',
      finalQuery: 'SELECT 1',
      summary: { columns: ['a', 'b'], types: ['number', 'text'], totalRows: 1 },
      data: { markdown: '| a | b |\n| --- | --- |\n| 1 | x |\n', shownRows: 1, truncated: false },
    }]);
  });

  it('attaches each query result to the right reference (dashboard → questions)', () => {
    const dash: CompressedAugmentedFile = {
      fileState: { id: 10, name: 'dash', path: '/org/dash', type: 'dashboard', isDirty: false, markup: '<dashboard/>' },
      references: [
        { id: 2, name: 'q2', path: '/org/q2', type: 'question', isDirty: false, queryResultId: 'h2', markup: '<question id="2"/>' },
        { id: 3, name: 'q3', path: '/org/q3', type: 'question', isDirty: false, queryResultId: 'h3', markup: '<question id="3"/>' },
      ],
      queryResults: [
        { columns: ['x'], types: ['number'], data: '| x |\n| --- |\n| 9 |\n', totalRows: 1, shownRows: 1, truncated: false, id: 'h2' },
        { columns: ['y'], types: ['number'], data: '| y |\n| --- |\n| 8 |\n', totalRows: 1, shownRows: 1, truncated: false, id: 'h3' },
      ],
    };
    const out = compressedToAugmentedFiles(dash);
    expect(out.file.queryResults).toBeUndefined(); // the dashboard itself has no direct result
    expect(out.references.map((r) => r.id)).toEqual([2, 3]);
    expect(out.references[0].queryResults?.[0].queryResultId).toBe('h2');
    expect(out.references[1].queryResults?.[0].queryResultId).toBe('h3');
    // markup is preserved in the rich shape (the projector suppresses ref markup later, not here)
    expect(out.references[0].content).toEqual({ markup: '<question id="2"/>' });
  });

  it('keeps summary but no data facet for an errored result (data was empty)', () => {
    const errored: CompressedAugmentedFile = {
      fileState: { id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, queryResultId: 'hE' },
      references: [],
      queryResults: [{ columns: [], types: [], data: '', totalRows: 0, shownRows: 0, truncated: false, id: 'hE', error: 'boom' }],
    };
    const out = compressedToAugmentedFiles(errored);
    expect(out.file.queryResults).toEqual([{
      queryResultId: 'hE',
      error: 'boom',
      summary: { columns: [], types: [], totalRows: 0 },
    }]);
    expect(out.file.queryResults?.[0].data).toBeUndefined();
  });

  it('passes a remote (http) screenshot URL through as image.url', () => {
    const withImg: CompressedAugmentedFile = {
      fileState: { id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, image: { key: 'file:1:abc', url: 'https://s3/shot.jpg' } },
      references: [],
      queryResults: [],
    };
    expect(compressedToAugmentedFiles(withImg).file.image).toEqual({
      key: 'file:1:abc',
      image: { type: 'image', url: 'https://s3/shot.jpg' },
    });
  });

  it('SPLITS a data: URL screenshot into {data, mimeType} (provider needs the MIME, not a url)', () => {
    const withImg: CompressedAugmentedFile = {
      fileState: { id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, image: { key: 'k', url: 'data:image/jpeg;base64,QUJD' } },
      references: [],
      queryResults: [],
    };
    expect(compressedToAugmentedFiles(withImg).file.image).toEqual({
      key: 'k',
      image: { type: 'image', mimeType: 'image/jpeg', data: 'QUJD' },
    });
  });

  it('maps an already-split base64 file screenshot into the image facet', () => {
    const withImg: CompressedAugmentedFile = {
      fileState: { id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, image: { key: 'k', data: 'B64', mimeType: 'image/jpeg' } },
      references: [],
      queryResults: [],
    };
    expect(compressedToAugmentedFiles(withImg).file.image).toEqual({
      key: 'k',
      image: { type: 'image', data: 'B64', mimeType: 'image/jpeg' },
    });
  });

  it('omits the content facet when the file has no markup', () => {
    const noMarkup: CompressedAugmentedFile = {
      fileState: { id: 5, name: 'f', path: '/org/f', type: 'folder', isDirty: false },
      references: [],
      queryResults: [],
    };
    expect(compressedToAugmentedFiles(noMarkup).file.content).toBeUndefined();
  });
});
