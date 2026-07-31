/**
 * WYSIWYG AST write-back for format:'jsx' stories.
 *
 * `applyDomEditsToJsx` maps a contenteditable host's edited innerHTML back onto the JSX
 * source: locate the element by its `data-mx-ast` path, convert the HTML to sanitized JSX
 * nodes (validator-allowlisted tags/attrs only — hostile paste stripped, never saved),
 * splice component/embed children back from the ORIGINAL AST, and re-serialize.
 */
import { describe, it, expect } from 'vitest';

import { applyDomEditsToJsx, applyFormatEditsToJsx, isEditableTextHost } from '@/lib/data/story/jsx-edit';
import { parseJsx, validateJsxSource, type JsxElement } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';

/** Every write-back result must be valid, renderable story JSX. */
function expectValidStoryJsx(source: string) {
  expect(validateJsxSource(source, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS)).toEqual([]);
}

describe('applyDomEditsToJsx — text edits', () => {
  it('replaces a paragraph\'s text (simple text edit)', () => {
    const src = '<div><p>Hello world</p></div>';
    const { source, errors } = applyDomEditsToJsx(src, [{ astPath: '0.0', innerHtml: 'Goodbye world' }]);
    expect(errors).toEqual([]);
    expect(source).toBe('<div><p>Goodbye world</p></div>');
    expectValidStoryJsx(source);
  });

  it('keeps rich inline children — an edited <strong> word survives the round-trip', () => {
    const src = '<p>Hello <strong>bold</strong> world</p>';
    const { source, errors } = applyDomEditsToJsx(src, [
      // The DOM copy carries the interpreter's data-mx-ast stamp on the inline element;
      // it is a plain HTML tag, so the (edited) DOM copy wins and the stamp is stripped.
      { astPath: '0', innerHtml: 'Hello <strong data-mx-ast="0.1">bolder</strong> world!' },
    ]);
    expect(errors).toEqual([]);
    expect(source).toBe('<p>Hello <strong>bolder</strong> world!</p>');
    expect(source).not.toContain('data-mx-ast');
    expectValidStoryJsx(source);
  });

  it('decodes HTML entities and self-closes void tags', () => {
    const src = '<p>x</p>';
    const { source, errors } = applyDomEditsToJsx(src, [
      { astPath: '0', innerHtml: 'a &amp; b &lt;c&gt;&nbsp;d<br>e' },
    ]);
    expect(errors).toEqual([]);
    expect(source).toContain('<br />');
    const parsed = parseJsx(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const p = parsed.nodes[0] as JsxElement;
    const text = p.children.filter(c => c.type === 'text').map(c => (c as { value: string }).value).join('');
    expect(text).toBe('a & b <c> de');
    expectValidStoryJsx(source);
  });
});

describe('applyDomEditsToJsx — hostile paste sanitization', () => {
  it('strips onclick attributes, <iframe> elements and javascript: hrefs out of the result', () => {
    const src = '<p>safe</p>';
    const { source } = applyDomEditsToJsx(src, [{
      astPath: '0',
      innerHtml:
        'Hi <span onclick="evil()">x</span>' +
        '<iframe src="https://evil.example/"></iframe>' +
        '<a href="javascript:alert(1)">link</a>' +
        '<script>steal()</script> bye',
    }]);
    expect(source).not.toContain('onclick');
    expect(source).not.toContain('iframe');
    expect(source).not.toContain('javascript:');
    expect(source).not.toContain('steal()');
    expect(source).toContain('<span>x</span>');
    expect(source).toContain('<a>link</a>'); // element kept, poisoned href dropped
    expect(source).toContain('Hi ');
    expect(source).toContain(' bye');
    expectValidStoryJsx(source);
  });

  it('sanitizes obfuscated URL schemes and denied attributes', () => {
    const { source } = applyDomEditsToJsx('<p>x</p>', [{
      astPath: '0',
      innerHtml: '<a href="java\tscript:alert(1)" is="x-evil" srcdoc="<script>">t</a>',
    }]);
    expect(source).not.toContain('script:');
    expect(source).not.toContain('is=');
    expect(source).not.toContain('srcdoc');
    expect(source).toContain('<a>t</a>');
    expectValidStoryJsx(source);
  });

  it('unwraps non-allowlisted (but not dangerous) tags, keeping their text', () => {
    const { source } = applyDomEditsToJsx('<p>x</p>', [{
      astPath: '0', innerHtml: 'a <font color="red">red</font> b',
    }]);
    expect(source).not.toContain('font');
    expect(source).toContain('a red b');
    expectValidStoryJsx(source);
  });
});

describe('applyDomEditsToJsx — attribute canonicalization', () => {
  it('normalizes DOM `class` attributes to className on edited inline elements', () => {
    // contenteditable innerHTML always serializes `class=` — the JSX source canon is className.
    const { source, errors } = applyDomEditsToJsx('<p>x</p>', [
      { astPath: '0', innerHtml: 'a <em class="italic">b</em>' },
    ]);
    expect(errors).toEqual([]);
    expect(source).toBe('<p>a <em className="italic">b</em></p>');
    expectValidStoryJsx(source);
  });
});

describe('applyDomEditsToJsx — embed/component preservation', () => {
  it('preserves a <Number id={5}/> inside the edited paragraph verbatim (from the AST, not the DOM)', () => {
    const src = '<p>Revenue <Number id={5} suffix="%" /> up</p>';
    const { source, errors } = applyDomEditsToJsx(src, [{
      astPath: '0',
      // The embed's rendered DOM chrome is NOT parseable back to JSX — the data-mx-ast stamp
      // marks it and the ORIGINAL AST child is spliced back in its place.
      innerHtml: 'Revenue was <span data-mx-ast="0.1" contenteditable="false">42%</span> way up',
    }]);
    expect(errors).toEqual([]);
    expect(source).toBe('<p>Revenue was <Number id={5} suffix="%" /> way up</p>');
    expectValidStoryJsx(source);
  });
});

describe('applyDomEditsToJsx — batches and failure modes', () => {
  it('applies a multi-edit batch against one source', () => {
    const src = '<div><p>one</p><p>two</p></div><p>three</p>';
    const { source, errors } = applyDomEditsToJsx(src, [
      { astPath: '0.0', innerHtml: 'ONE' },
      { astPath: '0.1', innerHtml: 'TWO <em>now</em>' },
      { astPath: '1', innerHtml: 'THREE' },
    ]);
    expect(errors).toEqual([]);
    expect(source).toBe('<div><p>ONE</p><p>TWO <em>now</em></p></div><p>THREE</p>');
    expectValidStoryJsx(source);
  });

  it('reports an error and leaves the source untouched for an unresolvable AST path', () => {
    const src = '<p>keep</p>';
    const { source, errors } = applyDomEditsToJsx(src, [{ astPath: '9.9', innerHtml: 'x' }]);
    expect(errors.length).toBeGreaterThan(0);
    expect(source).toBe('<p>keep</p>');
  });

  it('returns the original source with an error when the source itself does not parse', () => {
    const bad = '<p>unterminated';
    const { source, errors } = applyDomEditsToJsx(bad, [{ astPath: '0', innerHtml: 'x' }]);
    expect(source).toBe(bad);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('isEditableTextHost', () => {
  const el = (src: string): JsxElement => {
    const parsed = parseJsx(src);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.nodes[0] as JsxElement;
  };

  it('accepts an element with non-whitespace text children and inline markup', () => {
    expect(isEditableTextHost(el('<p>Hello <strong>bold</strong></p>'))).toBe(true);
  });

  it('rejects elements without direct non-whitespace text', () => {
    expect(isEditableTextHost(el('<div>  <p>text</p></div>'))).toBe(false);
    expect(isEditableTextHost(el('<div><p>text</p></div>'))).toBe(false);
  });

  it('rejects hosts with component/embed descendants (embeds stay locked)', () => {
    expect(isEditableTextHost(el('<p>Revenue <Number id={5} /> up</p>'))).toBe(false);
    expect(isEditableTextHost(el('<p>Deep <span><Number id={5} /></span> one</p>'))).toBe(false);
  });

  it('rejects components themselves and <style> hosts', () => {
    expect(isEditableTextHost(el('<CardTitle>Title</CardTitle>'))).toBe(false);
    expect(isEditableTextHost(el('<style>p &#123; color: red &#125;</style>'))).toBe(false);
  });
});

describe('applyFormatEditsToJsx — className/style attr write-back (typography toolbar)', () => {
  it('sets className on a plain HTML element that had none', () => {
    const src = '<div><p>Hello</p></div>';
    const out = applyFormatEditsToJsx(src, [{ astPath: '0.0', className: 'text-2xl font-bold' }]);
    expect(out).toBe('<div><p className="text-2xl font-bold">Hello</p></div>');
    expectValidStoryJsx(out);
  });

  it('replaces an existing className in place', () => {
    const src = '<div className="p-8"><h2 className="text-xl mt-4">Head</h2></div>';
    const out = applyFormatEditsToJsx(src, [{ astPath: '0.0', className: 'text-3xl mt-4' }]);
    expect(out).toBe('<div className="p-8"><h2 className="text-3xl mt-4">Head</h2></div>');
    expectValidStoryJsx(out);
  });

  it('an empty className removes the attribute', () => {
    const src = '<p className="text-xl">x</p>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0', className: '  ' }])).toBe('<p>x</p>');
  });

  it('applies multiple edits in one pass', () => {
    const src = '<div><p>a</p><p>b</p></div>';
    const out = applyFormatEditsToJsx(src, [
      { astPath: '0.0', className: 'text-sm' },
      { astPath: '0.1', className: 'text-lg' },
    ]);
    expect(out).toBe('<div><p className="text-sm">a</p><p className="text-lg">b</p></div>');
  });

  it('skips components, stale paths and text nodes — source comes back unchanged', () => {
    const src = '<div><Card>x</Card>text</div>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0.0', className: 'text-xl' }])).toBe(src);
    expect(applyFormatEditsToJsx(src, [{ astPath: '9.9', className: 'text-xl' }])).toBe(src);
    expect(applyFormatEditsToJsx(src, [{ astPath: '0.1', className: 'text-xl' }])).toBe(src);
  });

  it('returns unparseable source unchanged (never throws)', () => {
    const src = '<div><p>broken';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0.0', className: 'text-xl' }])).toBe(src);
  });

  it('sets an inline style string (color picker) without touching className', () => {
    const src = '<p className="text-xl">x</p>';
    const out = applyFormatEditsToJsx(src, [{ astPath: '0', style: 'color: rgb(255, 0, 0);' }]);
    expect(out).toBe('<p className="text-xl" style="color: rgb(255, 0, 0);">x</p>');
    expectValidStoryJsx(out);
  });

  it('an empty style removes the attribute; className edits compose in the same call', () => {
    const src = '<p className="a" style="color: red">x</p>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0', style: '' }])).toBe('<p className="a">x</p>');
    expect(applyFormatEditsToJsx(src, [{ astPath: '0', className: 'b', style: 'color: blue' }]))
      .toBe('<p className="b" style="color: blue">x</p>');
  });

  it('an edit with neither field applies nothing', () => {
    const src = '<p className="a">x</p>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0' }])).toBe(src);
  });

  it('replaces a legacy `class` attribute in place — never a duplicate className', () => {
    const src = '<h1 class="text-5xl font-bold">x</h1>';
    const out = applyFormatEditsToJsx(src, [{ astPath: '0', className: 'text-lg font-bold' }]);
    expect(out).toBe('<h1 className="text-lg font-bold">x</h1>');
    expectValidStoryJsx(out);
  });

  it('heals an element carrying BOTH class and className to a single className', () => {
    const src = '<h1 class="a" className="b">x</h1>';
    expect(applyFormatEditsToJsx(src, [{ astPath: '0', className: 'c' }])).toBe('<h1 className="c">x</h1>');
  });

  it('composes with applyDomEditsToJsx — text edit then class edit on the same host', () => {
    const src = '<div><p className="text-base">Hello</p></div>';
    const afterText = applyDomEditsToJsx(src, [{ astPath: '0.0', innerHtml: 'Goodbye <strong>all</strong>' }]).source;
    const out = applyFormatEditsToJsx(afterText, [{ astPath: '0.0', className: 'text-2xl' }]);
    expect(out).toBe('<div><p className="text-2xl">Goodbye <strong>all</strong></p></div>');
    expectValidStoryJsx(out);
  });
});
