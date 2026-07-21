/**
 * Phase 1 security hardening (Story_Design_V2 §2): the validator is the shared gate for
 * agent markup, code-view edits, AND the WYSIWYG write-back — a real XSS boundary, since
 * `content.story` is org-user-editable and rendered to other viewers (public guests included).
 *
 * Beyond the existing rules (non-static expressions, on* handlers, dangerous tags, URL
 * schemes) this adds: name-denied attributes (dangerouslySetInnerHTML, ref, key, srcDoc,
 * is), srcset/ping as URL-bearing attributes, and scheme-filter robustness against the
 * classic obfuscations (whitespace/control chars inside the scheme, mixed case).
 */
import { describe, it, expect } from 'vitest';
import { validateJsxSource } from '../index';

const C = ['Question', 'Card', 'Button'];
const bad = (src: string) => validateJsxSource(src, C);
const ok = (src: string) => expect(validateJsxSource(src, C)).toEqual([]);

describe('name-denied attributes (hard reject, any tag)', () => {
  it('rejects dangerouslySetInnerHTML even as a static object literal', () => {
    const errs = bad('<div dangerouslySetInnerHTML={{ __html: "<img onerror=alert(1)>" }} />');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].attr).toBe('dangerouslySetInnerHTML');
  });
  it('rejects ref and key', () => {
    expect(bad('<Card ref="x" />').length).toBeGreaterThan(0);
    expect(bad('<Card key="x" />').length).toBeGreaterThan(0);
  });
  it('rejects srcDoc / srcdoc and is', () => {
    expect(bad('<div srcDoc="<script>1</script>" />').length).toBeGreaterThan(0);
    expect(bad('<div srcdoc="x" />').length).toBeGreaterThan(0);
    expect(bad('<div is="custom-el" />').length).toBeGreaterThan(0);
  });
});

describe('URL-bearing attributes: srcset and ping', () => {
  it('rejects javascript: hidden inside srcset', () => {
    expect(bad('<img srcset="javascript:alert(1) 1x" />').length).toBeGreaterThan(0);
    expect(bad('<img srcset="https://a/x.png 1x, javascript:alert(1) 2x" />').length).toBeGreaterThan(0);
  });
  it('rejects ping URLs with dangerous schemes and allows none/https', () => {
    expect(bad('<a href="https://x" ping="javascript:alert(1)">x</a>').length).toBeGreaterThan(0);
    ok('<a href="https://x" ping="https://t.example/p">x</a>');
  });
  it('still allows normal image srcset', () => {
    ok('<img src="https://a/x.png" srcset="https://a/x.png 1x, https://a/y.png 2x" />');
  });
});

describe('scheme-filter obfuscation (fuzz shapes)', () => {
  // JSX attribute strings do not process backslash escapes, so the dangerous shapes are
  // LITERAL control characters inside the attribute value — built here with template
  // literals so real \t/\n/\r bytes land in the parsed source.
  it.each([
    ['tab inside scheme', `<a href="java\tscript:alert(1)">x</a>`],
    ['newline inside scheme', `<a href="java\nscript:alert(1)">x</a>`],
    ['CR inside scheme', `<a href="java\rscript:alert(1)">x</a>`],
    ['leading whitespace', `<a href=" \tjavascript:alert(1)">x</a>`],
    ['mixed case', `<a href="JaVaScRiPt:alert(1)">x</a>`],
    ['tab before colon', `<a href="vbscript\t:x">x</a>`],
  ])('rejects %s', (_name, src) => {
    expect(bad(src).length).toBeGreaterThan(0);
  });
  it('allows genuinely safe schemes and relative URLs', () => {
    ok('<a href="https://example.com">x</a>');
    ok('<a href="/f/12">x</a>');
    ok('<a href="mailto:a@b.c">x</a>');
    ok('<img src="data:image/png;base64,AAAA" />');
  });
});

describe('parse restrictions (already-enforced contracts, pinned)', () => {
  it('rejects spread attributes', () => {
    expect(bad('<Card {...props} />').length).toBeGreaterThan(0);
  });
  it('rejects non-literal expression attributes and children', () => {
    expect(bad('<Card title={window.name} />').length).toBeGreaterThan(0);
    expect(bad('<div>{alert(1)}</div>').length).toBeGreaterThan(0);
  });
  it('rejects member-expression component tags', () => {
    expect(bad('<Foo.Bar />').length).toBeGreaterThan(0);
  });
  it('rejects unknown components and dangerous HTML tags', () => {
    expect(bad('<NotRegistered />').length).toBeGreaterThan(0);
    expect(bad('<iframe src="https://x" />').length).toBeGreaterThan(0);
    expect(bad('<form action="/x" />').length).toBeGreaterThan(0);
  });
  it('allows static JSON-literal attributes (embeds rely on them)', () => {
    ok('<Question id={1017} viz={{ type: "bar" }} />');
  });
});
