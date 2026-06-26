// Renderer + conversation-level projection — the exact wire format the model sees. JSON in a tagged
// envelope; markup/query-data as raw correlated blocks; images as native blocks. Cross-turn repeats
// collapse via a single shared memo.
import { describe, it, expect } from 'vitest';
import { FacetMemo } from '../facets';
import { renderProjectedFiles, renderConversationFiles } from '../render';
import { projectFiles } from '../project';
import type { AugmentedFileEntry, AugmentedFiles, ProjectedFilesOutput } from '../types';
import type { ImageContent, TextContent } from '@/orchestrator/llm';

function img(url: string): ImageContent {
  return { type: 'image', url, mimeType: 'image/jpeg' };
}
const entry = (id: number, over: Partial<AugmentedFileEntry> = {}): AugmentedFileEntry => ({
  id,
  data: { id, name: `q${id}`, path: `/org/q${id}`, type: 'question', isDirty: false, queryResultId: `h${id}` },
  content: { markup: `<question id="${id}"/>` },
  image: { key: `img-${id}`, image: img(`https://s3/${id}.jpg`) },
  queryResults: [{
    queryResultId: `h${id}`,
    summary: { columns: ['a'], types: ['number'], totalRows: 3 },
    data: { markdown: `| a |\n| --- |\n| 1 |\n`, shownRows: 1, truncated: false },
  }],
  ...over,
});
const files = (file: AugmentedFileEntry, references: AugmentedFileEntry[] = []): AugmentedFiles => ({ file, references });

describe('renderProjectedFiles', () => {
  it('wraps the JSON in the given tag and appends markup + query_data as raw blocks, then images', () => {
    const out: ProjectedFilesOutput = projectFiles(new FacetMemo(), files(entry(1)));
    const blocks = renderProjectedFiles(out, { jsonTag: 'AppState' });

    expect(blocks).toHaveLength(2); // one text block, one image (file image only; see note below)
    const text = (blocks[0] as TextContent).text;
    expect(text.startsWith('<AppState>{')).toBe(true);
    expect(text).toContain('</AppState>');
    expect(text).toContain('<file_markup file_id="1" type="question">\n<question id="1"/>\n</file_markup>');
    expect(text).toContain('<query_data query_result_id="h1">\n| a |\n| --- |\n| 1 |\n\n</query_data>');
    // raw markup is NOT escaped JSON
    expect(text).not.toContain('\\n<question');
  });

  it('emits the file image as a content block after the text block', () => {
    const out = projectFiles(new FacetMemo(), files(entry(1)));
    const blocks = renderProjectedFiles(out, { jsonTag: 'AppState' });
    expect(blocks.filter((b) => b.type === 'image')).toEqual([img('https://s3/1.jpg')]);
  });

  it('uses the provided json tag (e.g. Files for a tool result)', () => {
    const out = projectFiles(new FacetMemo(), files(entry(1)));
    const text = (renderProjectedFiles(out, { jsonTag: 'Files' })[0] as TextContent).text;
    expect(text.startsWith('<Files>')).toBe(true);
  });
});

describe('renderConversationFiles — cross-turn diffing', () => {
  it('turn 1 emits full (markup + images); an identical turn 2 emits only the lean JSON, no blocks/images', () => {
    const memo = new FacetMemo();
    const [t1, t2] = renderConversationFiles(memo, [
      { files: files(entry(1)), jsonTag: 'AppState' },
      { files: files(entry(1)), jsonTag: 'AppState' },
    ]);

    // turn 1: text + the file image
    expect(t1.filter((b) => b.type === 'image')).toEqual([img('https://s3/1.jpg')]);
    expect((t1[0] as TextContent).text).toContain('<file_markup');

    // turn 2: ONE text block only, no markup/query_data/images
    expect(t2.filter((b) => b.type === 'image')).toEqual([]);
    const t2text = (t2[0] as TextContent).text;
    expect(t2text).not.toContain('<file_markup');
    expect(t2text).not.toContain('<query_data');
    expect(t2text).toContain('"unchanged":true');
  });
});
