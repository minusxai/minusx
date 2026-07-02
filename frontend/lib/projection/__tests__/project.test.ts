// The pure projector — rich AugmentedFiles → LLM-facing JSON + out-of-JSON blocks, diffing every
// facet against a forward FacetMemo. These assert the contract the Phase C boundary depends on:
// first turn emits everything in full; identical repeats collapse to {unchanged:true} with NO
// blocks; each facet (data/markup/image/summary/qr-data/qr-image) diffs independently; heavy
// facets live OUTSIDE the JSON; images diff on key not payload; ids dedup across primary/reference.
import { describe, it, expect } from 'vitest';
import { FacetMemo, isUnchanged } from '../facets';
import { projectFiles, stripEntryMarkup, stripEntryQueryData } from '../project';
import type { AugmentedFileEntry, AugmentedFiles, ChangedQueryResultJson, ProjectedQueryResultJson } from '../types';
import type { ImageContent } from '@/orchestrator/llm';

/** Narrow a projected query result to its full (non-collapsed) form for field-level assertions. */
const changed = (qr: ProjectedQueryResultJson | undefined) => qr as ChangedQueryResultJson;

function img(url: string): ImageContent {
  return { type: 'image', url, mimeType: 'image/jpeg' };
}

function question(id: number, over: Partial<AugmentedFileEntry> = {}): AugmentedFileEntry {
  return {
    id,
    data: { id, name: `q${id}`, path: `/org/q${id}`, type: 'question', isDirty: false, queryResultId: `h${id}` },
    content: { markup: `<question id="${id}"/>` },
    image: { key: `img-${id}-v1`, image: img(`https://s3/${id}-v1.jpg`) },
    queryResults: [{
      queryResultId: `h${id}`,
      summary: { columns: ['a', 'b'], types: ['number', 'text'], totalRows: 10 },
      image: { key: `qrimg-${id}-v1`, image: img(`https://s3/qr-${id}-v1.jpg`) },
    }],
    ...over,
  };
}

const files = (file: AugmentedFileEntry, references: AugmentedFileEntry[] = []): AugmentedFiles => ({ file, references });

describe('projectFiles — first turn', () => {
  it('emits every facet in full: data inline, markup + image + qr-image as blocks', () => {
    const memo = new FacetMemo();
    const out = projectFiles(memo, files(question(1)));

    expect(out.json.file.data).toEqual({ id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, queryResultId: 'h1' });
    expect(out.json.file.content).toEqual({ state: 'present' });
    expect(out.json.file.image).toEqual({ state: 'present' });
    expect(changed(out.json.file.queryResults?.[0]).summary).toEqual({ columns: ['a', 'b'], types: ['number', 'text'], totalRows: 10 });
    expect(changed(out.json.file.queryResults?.[0]).image).toEqual({ state: 'present' });

    // markup is OUTSIDE the json, correlated by file id
    expect(out.textBlocks).toEqual([{ kind: 'markup', fileId: 1, type: 'question', text: '<question id="1"/>' }]);
    // both images (file + qr viz) emitted as native blocks
    expect(out.images).toEqual([img('https://s3/1-v1.jpg'), img('https://s3/qr-1-v1.jpg')]);
  });
});

describe('projectFiles — identical repeat', () => {
  it('collapses ALL facets to unchanged and emits NO blocks', () => {
    const memo = new FacetMemo();
    projectFiles(memo, files(question(1)));            // turn 1: full
    const out = projectFiles(memo, files(question(1))); // turn 2: identical

    expect(isUnchanged(out.json.file.data)).toBe(true);
    expect(out.json.file.content).toEqual({ state: 'unchanged' });
    expect(out.json.file.image).toEqual({ state: 'unchanged' });
    // the whole query result collapsed — every facet unchanged, so no per-facet object
    expect(out.json.file.queryResults![0]).toEqual({ queryResultId: 'h1', unchanged: true });
    expect(out.textBlocks).toEqual([]);
    expect(out.images).toEqual([]);
  });
});

describe('projectFiles — independent facet diffing', () => {
  it('re-emits only markup when only markup changed (image/data stay unchanged)', () => {
    const memo = new FacetMemo();
    projectFiles(memo, files(question(1)));
    const edited = question(1, { content: { markup: '<question id="1" edited/>' } });
    const out = projectFiles(memo, files(edited));

    expect(out.json.file.content).toEqual({ state: 'present' });
    expect(out.json.file.image).toEqual({ state: 'unchanged' });
    expect(out.textBlocks).toEqual([{ kind: 'markup', fileId: 1, type: 'question', text: '<question id="1" edited/>' }]);
    expect(out.images).toEqual([]); // image unchanged → not re-sent
  });

  it('re-emits only the image when only the image key changed', () => {
    const memo = new FacetMemo();
    projectFiles(memo, files(question(1)));
    const rerendered = question(1, { image: { key: 'img-1-v2', image: img('https://s3/1-v2.jpg') } });
    const out = projectFiles(memo, files(rerendered));

    expect(out.json.file.content).toEqual({ state: 'unchanged' });
    expect(out.json.file.image).toEqual({ state: 'present' });
    expect(out.images).toEqual([img('https://s3/1-v2.jpg')]);
    expect(out.textBlocks).toEqual([]);
  });

  it('diffs the image on key only — same key, different payload → still unchanged (no re-send)', () => {
    const memo = new FacetMemo();
    projectFiles(memo, files(question(1)));
    // Same key, different url (e.g. a re-signed S3 URL) must NOT count as a change.
    const resigned = question(1, { image: { key: 'img-1-v1', image: img('https://s3/1-v1-RESIGNED.jpg') } });
    const out = projectFiles(memo, files(resigned));
    expect(out.json.file.image).toEqual({ state: 'unchanged' });
    expect(out.images).toEqual([]);
  });
});

describe('projectFiles — query data (rows)', () => {
  it('emits query data as an out-of-JSON block when present, then collapses on repeat', () => {
    const withData = question(1, {
      content: undefined, // isolate: no markup block, only the querydata block
      image: undefined,
      queryResults: [{
        queryResultId: 'h1',
        summary: { columns: ['a'], types: ['number'], totalRows: 2 },
        data: { markdown: '| a |\n| --- |\n| 1 |\n| 2 |\n', shownRows: 2, truncated: false },
      }],
    });
    const memo = new FacetMemo();
    const t1 = projectFiles(memo, files(withData));
    expect(changed(t1.json.file.queryResults![0]).data).toEqual({ state: 'present' });
    expect(t1.textBlocks).toEqual([{ kind: 'querydata', queryResultId: 'h1', text: '| a |\n| --- |\n| 1 |\n| 2 |\n' }]);

    const t2 = projectFiles(memo, files(withData));
    // identical repeat → whole entry collapses (data + summary both unchanged), no blocks
    expect(t2.json.file.queryResults![0]).toEqual({ queryResultId: 'h1', unchanged: true });
    expect(t2.textBlocks).toEqual([]);
  });

  it('omits the data field entirely when a result carries no rows (image-only)', () => {
    const memo = new FacetMemo();
    const out = projectFiles(memo, files(question(1))); // question() has no qr.data
    expect(changed(out.json.file.queryResults![0]).data).toBeUndefined();
  });
});

describe('projectFiles — finalQuery (executed SQL) diffing', () => {
  const withSql = (sql: string) => question(1, {
    content: undefined, image: undefined,
    queryResults: [{
      queryResultId: 'h1',
      finalQuery: sql,
      summary: { columns: ['a'], types: ['number'], totalRows: 1 },
    }],
  });

  it('emits finalQuery in full on the first turn, then collapses the whole entry on an identical repeat', () => {
    const memo = new FacetMemo();
    const t1 = projectFiles(memo, files(withSql('SELECT 1')));
    expect((t1.json.file.queryResults![0] as { finalQuery?: unknown }).finalQuery).toBe('SELECT 1');

    // identical repeat → the entire query result collapses (finalQuery + summary both unchanged)
    const t2 = projectFiles(memo, files(withSql('SELECT 1')));
    expect(t2.json.file.queryResults![0]).toEqual({ queryResultId: 'h1', unchanged: true });
  });

  it('re-emits finalQuery (full entry) when the SQL changes but the summary does not', () => {
    const memo = new FacetMemo();
    projectFiles(memo, files(withSql('SELECT 1')));
    const t2 = projectFiles(memo, files(withSql('SELECT 2')));
    // summary unchanged but finalQuery moved → NOT collapsed; finalQuery re-emitted in full
    expect(changed(t2.json.file.queryResults![0]).finalQuery).toBe('SELECT 2');
    expect(isUnchanged(changed(t2.json.file.queryResults![0]).summary!)).toBe(true);
  });

  it('omits finalQuery entirely when the result has none', () => {
    const memo = new FacetMemo();
    const out = projectFiles(memo, files(question(1))); // question() has no finalQuery
    expect((out.json.file.queryResults![0] as { finalQuery?: unknown }).finalQuery).toBeUndefined();
  });
});

describe('projectFiles — finalQuery truncation (bounds a pathological SQL string)', () => {
  const withSql = (sql: string) => question(1, {
    content: undefined, image: undefined,
    queryResults: [{ queryResultId: 'h1', finalQuery: sql, summary: { columns: ['a'], types: ['number'], totalRows: 1 } }],
  });

  it('passes a short SQL string through verbatim (≤ 1000 chars)', () => {
    const sql = 'SELECT ' + 'a'.repeat(900);
    expect(sql.length).toBeLessThanOrEqual(1000);
    const out = projectFiles(new FacetMemo(), files(withSql(sql)));
    expect((out.json.file.queryResults![0] as { finalQuery?: unknown }).finalQuery).toBe(sql);
  });

  it('truncates a > 1000-char SQL to head 500 + marker + tail 500', () => {
    const head = 'H'.repeat(500);
    const mid = 'M'.repeat(4000);
    const tail = 'T'.repeat(500);
    const sql = head + mid + tail; // 5000 chars
    const out = projectFiles(new FacetMemo(), files(withSql(sql)));
    const emitted = (out.json.file.queryResults![0] as { finalQuery?: string }).finalQuery!;
    expect(emitted.startsWith(head)).toBe(true);     // first 500 preserved
    expect(emitted.endsWith(tail)).toBe(true);       // last 500 preserved
    expect(emitted).not.toContain(mid);              // the middle is elided
    expect(emitted.length).toBeLessThan(sql.length); // strictly smaller
    expect(emitted).toContain('truncated');          // an explicit truncation marker
  });
});

describe('projectFiles — query-result whole-entry collapse', () => {
  const qr = (over: Partial<import('../types').AugmentedQueryResult> = {}) => question(1, {
    content: undefined, image: undefined,
    queryResults: [{
      queryResultId: 'h1',
      finalQuery: 'SELECT 1',
      summary: { columns: ['a'], types: ['number'], totalRows: 1 },
      data: { markdown: '| a |\n| --- |\n| 1 |\n', shownRows: 1, truncated: false },
      ...over,
    }],
  });

  it('does NOT collapse the first time a result appears (everything is fresh)', () => {
    const out = projectFiles(new FacetMemo(), files(qr()));
    expect(out.json.file.queryResults![0]).not.toHaveProperty('unchanged');
    expect((out.json.file.queryResults![0] as { summary?: unknown }).summary).toBeDefined();
  });

  it('collapses to {queryResultId, unchanged:true} when EVERY facet repeats identically', () => {
    const memo = new FacetMemo();
    projectFiles(memo, files(qr()));
    const t2 = projectFiles(memo, files(qr()));
    expect(t2.json.file.queryResults![0]).toEqual({ queryResultId: 'h1', unchanged: true });
    expect(t2.textBlocks).toEqual([]); // no query_data block re-sent
  });

  it('does NOT collapse when only the summary moved (a real change must stay visible)', () => {
    const memo = new FacetMemo();
    projectFiles(memo, files(qr()));
    const t2 = projectFiles(memo, files(qr({ summary: { columns: ['a', 'b'], types: ['number', 'text'], totalRows: 2 } })));
    const entry = t2.json.file.queryResults![0];
    expect(entry).not.toHaveProperty('unchanged');
    expect((entry as { summary?: unknown }).summary).toEqual({ columns: ['a', 'b'], types: ['number', 'text'], totalRows: 2 });
  });

  it('does NOT collapse a result carrying an error, even if all else is unchanged', () => {
    const memo = new FacetMemo();
    projectFiles(memo, files(qr()));
    const t2 = projectFiles(memo, files(qr({ error: 'boom' })));
    const entry = t2.json.file.queryResults![0];
    expect(entry).not.toHaveProperty('unchanged');
    expect((entry as { error?: string }).error).toBe('boom');
  });
});

describe('projectFiles — references (policy: metadata-only)', () => {
  it('projects a reference with no content/image as data-only, no blocks', () => {
    const ref: AugmentedFileEntry = {
      id: 2,
      data: { id: 2, name: 'q2', path: '/org/q2', type: 'question', isDirty: false, queryResultId: 'h2' },
      queryResults: [{ queryResultId: 'h2', summary: { columns: ['x'], types: ['number'], totalRows: 5 } }],
    };
    const dashboard: AugmentedFileEntry = {
      id: 1,
      data: { id: 1, name: 'dash', path: '/org/dash', type: 'dashboard', isDirty: false },
      content: { markup: '<dashboard/>' },
    };
    const memo = new FacetMemo();
    const out = projectFiles(memo, files(dashboard, [ref]));

    expect(out.json.references).toHaveLength(1);
    expect(out.json.references[0].content).toBeUndefined();
    expect(out.json.references[0].image).toBeUndefined();
    expect(changed(out.json.references[0].queryResults![0]).summary).toEqual({ columns: ['x'], types: ['number'], totalRows: 5 });
    // only the dashboard's own markup is a block
    expect(out.textBlocks).toEqual([{ kind: 'markup', fileId: 1, type: 'dashboard', text: '<dashboard/>' }]);
  });

  it('suppresses a reference markup even when the entry carries content (policy)', () => {
    const memo = new FacetMemo();
    const refWithMarkup = question(2); // has content + image
    const out = projectFiles(memo, files(question(1), [refWithMarkup]));
    expect(out.json.references[0].content).toBeUndefined();        // markup never projected for refs
    expect(out.json.references[0].image).toEqual({ state: 'present' }); // images still allowed for refs
    // only the primary file's markup is a block; the reference's markup is not emitted
    expect(out.textBlocks.filter((b) => b.kind === 'markup')).toEqual([
      { kind: 'markup', fileId: 1, type: 'question', text: '<question id="1"/>' },
    ]);
  });

  it('dedups a file by id whether it appears as primary or reference', () => {
    const memo = new FacetMemo();
    // turn 1: file 2 is the focused (primary) question — full
    projectFiles(memo, files(question(2)));
    // turn 2: file 2 now appears as a reference under another file — its facets are unchanged
    const ref = question(2);
    const out = projectFiles(memo, files(question(1), [ref]));
    expect(isUnchanged(out.json.references[0].data)).toBe(true);
    expect(out.json.references[0].content).toBeUndefined(); // references are metadata-only (markup suppressed)
    expect(out.json.references[0].image).toEqual({ state: 'unchanged' });
  });
});

describe('stripEntryMarkup / stripEntryQueryData', () => {
  it('stripEntryMarkup drops content (markup), keeps data/image/queryResults', () => {
    const e = question(1);
    const out = stripEntryMarkup(e);
    expect(out.content).toBeUndefined();
    expect(out.data).toEqual(e.data);
    expect(out.image).toEqual(e.image);
    expect(out.queryResults).toEqual(e.queryResults);
  });

  it('stripEntryQueryData drops row data, keeps summary + everything else', () => {
    const e = question(1, { queryResults: [{ queryResultId: 'h1', summary: { columns: ['a'], types: ['number'], totalRows: 2 }, data: { markdown: '| a |\n', shownRows: 1, truncated: false } }] });
    const out = stripEntryQueryData(e);
    expect(out.queryResults?.[0].data).toBeUndefined();
    expect(out.queryResults?.[0].summary).toEqual({ columns: ['a'], types: ['number'], totalRows: 2 });
    expect(out.content).toEqual(e.content); // markup untouched
  });
});

describe('projectFiles — determinism', () => {
  it('two memos over the same turn sequence produce identical projections (cache stability)', () => {
    const seq = [files(question(1)), files(question(1)), files(question(1, { content: { markup: '<x/>' } }))];
    const run = () => {
      const m = new FacetMemo();
      return seq.map((s) => projectFiles(m, s).json);
    };
    expect(run()).toEqual(run());
  });
});
