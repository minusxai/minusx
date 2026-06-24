// validateJsx enforces the STATIC subset + security allowlist over a parsed AST.
// This is what makes `jsx` inert data, not code: JSON-literal attrs only, registered
// components only, allowed HTML tags, no event handlers, no dangerous URLs.
import { describe, it, expect } from 'vitest';
import { parseJsx } from '../parse';
import { validateJsx } from '../validate';
import type { ValidateOptions } from '../types';

const OPTS: ValidateOptions = { components: ['Question'] };

function errors(src: string, opts: ValidateOptions = OPTS) {
  const r = parseJsx(src);
  if (!r.ok) throw new Error(`parse failed: ${r.error}`);
  return validateJsx(r.nodes, opts);
}

describe('validateJsx — valid input', () => {
  it('accepts a registered component with JSON-literal attrs + text child', () => {
    expect(errors(`<Question connection="github" viz={{type:"bar",xCols:["a"]}}>SELECT 1</Question>`)).toEqual([]);
  });
  it('accepts nested allowed HTML', () => {
    expect(errors(`<div class="soh"><h1>Title</h1><p>body</p></div>`)).toEqual([]);
  });
  it('allows a data:image URL', () => {
    expect(errors(`<img src="data:image/png;base64,iVBORw0KGgo=" />`)).toEqual([]);
  });
});

describe('validateJsx — static subset', () => {
  it('rejects a non-static attribute expression', () => {
    const errs = errors(`<Question viz={computeViz()} />`);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].attr).toBe('viz');
    expect(errs[0].message).toMatch(/json literal|static/i);
  });
  it('rejects a spread attribute', () => {
    expect(errors(`<Question {...spread} />`).length).toBeGreaterThan(0);
  });
  it('rejects a non-static expression child', () => {
    expect(errors(`<div>{fn()}</div>`).length).toBeGreaterThan(0);
  });
});

describe('validateJsx — security', () => {
  it('rejects a <script> tag', () => {
    const errs = errors(`<div><script>alert(1)</script></div>`);
    expect(errs.some((e) => e.tag === 'script')).toBe(true);
  });
  it.each(['iframe', 'object', 'embed', 'base', 'meta', 'link', 'form'])('rejects dangerous tag <%s>', (tag) => {
    expect(errors(`<${tag}></${tag}>`).length).toBeGreaterThan(0);
  });
  it('rejects an on* event handler (string)', () => {
    expect(errors(`<div onclick="steal()">x</div>`).length).toBeGreaterThan(0);
  });
  it('rejects an on* event handler (camelCase)', () => {
    expect(errors(`<div onClick={"steal"}>x</div>`).length).toBeGreaterThan(0);
  });
  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', ' vbscript:x', 'data:text/html,<script>'])(
    'rejects dangerous URL scheme %s',
    (url) => {
      expect(errors(`<a href="${url}">x</a>`).length).toBeGreaterThan(0);
    },
  );
});

describe('validateJsx — component registry', () => {
  it('rejects an unregistered component', () => {
    const errs = errors(`<Chart />`, { components: ['Question'] });
    expect(errs.some((e) => e.tag === 'Chart')).toBe(true);
  });
  it('accepts a component once registered', () => {
    expect(errors(`<Chart />`, { components: ['Question', 'Chart'] })).toEqual([]);
  });
  it('restricts HTML tags when allowedHtmlTags is provided', () => {
    expect(errors(`<marquee>x</marquee>`, { components: ['Question'], allowedHtmlTags: ['div', 'p'] }).length).toBeGreaterThan(0);
    expect(errors(`<div>x</div>`, { components: ['Question'], allowedHtmlTags: ['div', 'p'] })).toEqual([]);
  });
});
