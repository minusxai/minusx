// A dangerous URL scheme must be rejected under EVERY spelling of the attribute.
//
// Story markup passes two independent gates: `validateJsxSource` at SAVE time
// (`lib/jsx/validate.ts`) and the interpreter at RENDER time
// (`lib/story-ui/interpreter.tsx`). Both lowercase the attribute name and look it
// up in a set of URL-bearing attributes — and those two sets were maintained by
// hand, so they drifted: one had `'xlink:href'`, the other `'xlinkhref'`.
//
// Because each gate lowercases first, that meant `xlink:href` (the SVG spelling)
// was caught only at save time and `xlinkHref` (React's spelling) only at render
// time. Each spelling had one gate instead of two, so a single miss anywhere in
// either path was enough. `xlink:href` on an inline `<svg><a>` executes script in
// browsers that honour it, so this is the live XSS boundary.
//
// The sets are now one shared constant (`lib/jsx/url-attrs.ts`), which makes
// divergence impossible rather than merely detected. These tests assert the
// behaviour that constant exists to guarantee.

import { describe, it, expect } from 'vitest';
import { validateJsxSource } from '../index';
import { URL_ATTRS } from '../url-attrs';

const COMPONENTS = ['Question'];
const errorsFor = (src: string) => validateJsxSource(src, COMPONENTS);

describe('URL-scheme rejection covers every spelling of an attribute', () => {
  it('rejects javascript: in the SVG spelling xlink:href', () => {
    expect(errorsFor('<svg><a xlink:href="javascript:alert(1)">x</a></svg>')).not.toEqual([]);
  });

  it('rejects javascript: in the React spelling xlinkHref', () => {
    expect(errorsFor('<svg><a xlinkHref="javascript:alert(1)">x</a></svg>')).not.toEqual([]);
  });

  it('rejects javascript: in plain href, the baseline case', () => {
    expect(errorsFor('<a href="javascript:alert(1)">x</a>')).not.toEqual([]);
  });

  it('allows a safe URL in either xlink spelling', () => {
    expect(errorsFor('<svg><a xlink:href="https://example.com">x</a></svg>')).toEqual([]);
    expect(errorsFor('<svg><a xlinkHref="https://example.com">x</a></svg>')).toEqual([]);
  });

  it('carries both lowercased xlink spellings, since each gate lowercases before lookup', () => {
    expect(URL_ATTRS.has('xlink:href')).toBe(true);
    expect(URL_ATTRS.has('xlinkhref')).toBe(true);
  });
});
