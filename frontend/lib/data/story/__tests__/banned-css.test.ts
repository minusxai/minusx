/**
 * Banned story CSS (Story_Design_V2 §4): one constant module feeding every enforcement point.
 *
 *  1. `position: fixed` / `position: sticky` — containing-block semantics break inside
 *     foreignObject, so a fixed element would render somewhere else in the capture.
 *  2. EVERY external-fetch construct — `url()` / `src()` function tokens and `@import` at-rules
 *     (string + functional form). Only `data:` URIs pass. Dual purpose: exfiltration guard (CSS
 *     fetches fired from guest viewers) and capture-taint guard.
 *
 * The sanitizer strips banned DECLARATIONS (never the whole sheet); the candidate filter drops
 * banned Tailwind candidates BEFORE compile, separate from the buildSalvaging error-bisect.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeCssText,
  sanitizeInlineStyle,
  sanitizeStoryMarkupCss,
  isBannedCandidate,
  partitionBannedCandidates,
} from '../banned-css';

describe('sanitizeCssText — declaration-level strip', () => {
  it('strips position: fixed and sticky, keeps sibling declarations', () => {
    const out = sanitizeCssText('.a{position:fixed;color:red}.b{position: sticky ;top:0}');
    expect(out).not.toMatch(/fixed|sticky/);
    expect(out).toContain('color:red');
    expect(out).toContain('top:0');
  });

  it('keeps other position values', () => {
    const out = sanitizeCssText('.a{position:absolute}.b{position:relative}');
    expect(out).toContain('absolute');
    expect(out).toContain('relative');
  });

  it('strips @import at-rules — string and functional form', () => {
    const out = sanitizeCssText(
      '@import "https://fonts.example/css";\n@import url(https://fonts.example/css2) screen;\n.a{color:red}',
    );
    expect(out).not.toContain('@import');
    expect(out).toContain('color:red');
  });

  it('lets a data: @import pass (no external fetch)', () => {
    const css = '@import url(data:text/css;base64,LmF7fQ==);.a{color:red}';
    expect(sanitizeCssText(css)).toContain('@import');
  });

  it('strips declarations with external url() but keeps data: URIs', () => {
    const out = sanitizeCssText(
      '.a{background:url(https://evil.example/x.png);color:red}'
      + '.b{background-image:url("data:image/png;base64,AAAA")}',
    );
    expect(out).not.toContain('evil.example');
    expect(out).toContain('color:red');
    expect(out).toContain('data:image/png');
  });

  it('strips relative and protocol-relative url() too (only data: passes)', () => {
    const out = sanitizeCssText('.a{background:url(/x.png)}.b{background:url(//cdn.example/y.png)}');
    expect(out).not.toContain('x.png');
    expect(out).not.toContain('y.png');
  });

  it('strips src() function tokens with external targets (e.g. @font-face src)', () => {
    const out = sanitizeCssText('@font-face{font-family:X;src:url(https://cdn.example/x.woff2)}');
    expect(out).not.toContain('cdn.example');
  });

  it('is not fooled by CSS escapes or case tricks', () => {
    // \75 is the CSS escape for "u" — `\75rl(...)` parses as url(...) in a real engine.
    const out = sanitizeCssText('.a{background:\\75 rl(https://evil.example/x)}.b{POSITION:FIXED}');
    expect(out).not.toContain('evil.example');
    expect(out).not.toMatch(/fixed/i);
  });

  it('is not fooled by comments inside the declaration', () => {
    const out = sanitizeCssText('.a{position:/* x */fixed;color:red}');
    expect(out).not.toMatch(/fixed/);
    expect(out).toContain('color:red');
  });

  it('leaves clean CSS byte-identical', () => {
    const css = '.card{border-radius:8px;box-shadow:0 1px 2px rgb(0 0 0/.1)}@media (min-width:600px){.card{padding:2rem}}';
    expect(sanitizeCssText(css)).toBe(css);
  });
});

describe('sanitizeInlineStyle', () => {
  it('drops banned declarations, keeps the rest', () => {
    expect(sanitizeInlineStyle('position:fixed;top:0;color:red')).not.toContain('fixed');
    expect(sanitizeInlineStyle('position:fixed;top:0;color:red')).toContain('color:red');
    expect(sanitizeInlineStyle('background:url(https://evil.example/x);padding:4px')).toBe('padding:4px');
  });

  it('leaves clean inline styles untouched', () => {
    expect(sanitizeInlineStyle('color:red;padding:4px')).toBe('color:red;padding:4px');
  });
});

describe('sanitizeStoryMarkupCss — <style> blocks and inline styles in story markup', () => {
  it('sanitizes <style> block contents in place', () => {
    const out = sanitizeStoryMarkupCss(
      '<div><style>@import "https://f.example/css";.hero{position:sticky;color:red}</style><p>hi</p></div>',
    );
    expect(out).not.toContain('@import');
    expect(out).not.toContain('sticky');
    expect(out).toContain('color:red');
    expect(out).toContain('<p>hi</p>');
  });

  it('sanitizes style attributes (double and single quoted)', () => {
    const out = sanitizeStoryMarkupCss(
      '<div style="position:fixed;color:red"><span style=\'background:url(https://e.example/x);margin:0\'>x</span></div>',
    );
    expect(out).not.toContain('fixed');
    expect(out).not.toContain('e.example');
    expect(out).toContain('color:red');
    expect(out).toContain('margin:0');
  });

  it('catches entity-encoded url() in style attributes', () => {
    const out = sanitizeStoryMarkupCss('<div style="background:url(&quot;https://evil.example/x&quot;)">x</div>');
    expect(out).not.toContain('evil.example');
  });

  it('leaves markup without banned CSS untouched', () => {
    const markup = '<div className="p-4"><style>.a{color:red}</style><img src="data:image/png;base64,AA"/></div>';
    expect(sanitizeStoryMarkupCss(markup)).toBe(markup);
  });
});

describe('isBannedCandidate — Tailwind candidate filter (pre-compile, separate from the bisect)', () => {
  it('bans fixed/sticky including variant and important forms', () => {
    for (const c of ['fixed', 'sticky', 'md:fixed', 'hover:sticky', '!fixed', 'dark:md:sticky']) {
      expect(isBannedCandidate(c), c).toBe(true);
    }
  });

  it('does not ban look-alike utilities', () => {
    for (const c of ['static', 'absolute', 'relative', 'top-0', 'shrink-0', 'text-sm', 'bg-fixed-ish', 'sticky-note']) {
      expect(isBannedCandidate(c), c).toBe(false);
    }
  });

  it('bans arbitrary values with external url(); data: passes', () => {
    expect(isBannedCandidate("bg-[url(https://evil.example/x.png)]")).toBe(true);
    expect(isBannedCandidate("bg-[url('/local.png')]")).toBe(true);
    expect(isBannedCandidate("content-[url(https://evil.example/x)]")).toBe(true);
    expect(isBannedCandidate("bg-[url(data:image/png;base64,AAAA)]")).toBe(false);
  });

  it("bans @import smuggled through arbitrary content", () => {
    expect(isBannedCandidate("content-['@import_url(https://e.example)']")).toBe(true);
    expect(isBannedCandidate("content-['hello']")).toBe(false);
  });

  it('partitions candidates preserving order of the kept set', () => {
    const { kept, banned } = partitionBannedCandidates(['p-4', 'fixed', 'bg-card', 'bg-[url(https://x.example/a)]']);
    expect(kept).toEqual(['p-4', 'bg-card']);
    expect(banned).toEqual(['fixed', 'bg-[url(https://x.example/a)]']);
  });
});
