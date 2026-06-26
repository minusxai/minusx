import { describe, it, expect } from 'vitest';
import { findDocsMissingMeta } from '../context-utils';
import type { DocEntry } from '@/lib/types';

describe('findDocsMissingMeta', () => {
  it('flags active docs missing a title or description', () => {
    const docs: (DocEntry | string)[] = [
      { content: 'a', title: 'Has both', description: 'ok' },        // 0 — valid
      { content: 'b', title: 'No desc' },                            // 1 — missing description
      { content: 'c', description: 'No title' },                     // 2 — missing title
      { content: 'd' },                                              // 3 — missing both
      { content: 'e', title: '  ', description: '  ' },              // 4 — whitespace only
    ];
    expect(findDocsMissingMeta(docs)).toEqual([1, 2, 3, 4]);
  });

  it('exempts draft docs and bare string docs', () => {
    const docs: (DocEntry | string)[] = [
      { content: 'a', draft: true },             // draft — exempt
      'plain string doc',                        // string — exempt
      { content: 'b', title: 'T', description: 'D' }, // valid
    ];
    expect(findDocsMissingMeta(docs)).toEqual([]);
  });

  it('returns no indices when every active doc is complete', () => {
    const docs: (DocEntry | string)[] = [
      { content: 'a', title: 'T1', description: 'D1', alwaysInclude: true },
      { content: 'b', title: 'T2', description: 'D2' },
    ];
    expect(findDocsMissingMeta(docs)).toEqual([]);
  });
});
