// @vitest-environment jsdom
/**
 * serializeEditedStory rebuilds a clean `content.story` string from the live
 * (edited) shadow-root DOM. It must undo everything AgentHtml does at render so
 * the saved HTML round-trips: drop the injected app-styles tag, restore each
 * chart embed to its authored empty placeholder (size from data-mx-osz), strip
 * contenteditable attributes, and re-insert the hoisted @import font lines.
 */
import { serializeEditedStory } from '@/lib/html/serialize-story';

/** Build a stand-in for AgentHtml's live shadow root after render + editing. */
function makeRoot(): HTMLDivElement {
  const root = document.createElement('div');
  root.innerHTML =
    '<style data-mx-app-styles>.app{color:red}</style>' +
    '<style data-mx-fluid-shim>[data-question-id]{width:100%}</style>' +
    "<style>.s{color:blue}</style>" +
    '<div class="s" contenteditable="true">' +
    '<h1>EDITED HEADLINE</h1>' +
    '<div data-question-id="5" data-mx-osz="width:100%;height:420px" contenteditable="false">' +
    '<div class="rendered-chart">live echarts junk</div>' +
    '</div>' +
    '<div data-question-inline="{&quot;query&quot;:&quot;SELECT 1&quot;,&quot;connection_name&quot;:&quot;duckdb&quot;}" data-mx-osz="width:100%;height:200px" contenteditable="false">' +
    '<div class="rendered-chart">inline echarts junk</div>' +
    '</div>' +
    '<span data-number-inline="{&quot;query&quot;:&quot;SELECT 1 AS v&quot;,&quot;connection&quot;:&quot;duck&quot;}" contenteditable="false">$1</span>' +
    '</div>';
  return root;
}

describe('serializeEditedStory', () => {
  it('drops the injected app-styles and fluid-shim tags', () => {
    const out = serializeEditedStory(makeRoot(), []);
    expect(out).not.toContain('data-mx-app-styles');
    expect(out).not.toContain('.app{color:red}');
    expect(out).not.toContain('data-mx-fluid-shim');
  });

  it('drops every render-injected data-mx-* style node (compiledCss, floating css, fonts)', () => {
    // Styles now live INSIDE the story root (Story_Design_V2 §4 self-contained doc), so every save
    // path reading root contents must strip them — else derived CSS compounds into content.story.
    const root = document.createElement('div');
    root.innerHTML =
      '<style data-mx-tw>.tw{display:flex}</style>' +
      '<style data-mx-floating>[data-scope=popover]{position:absolute}</style>' +
      '<style data-mx-fonts>@font-face{font-family:"Inter";src:url("/fonts/Inter-Variable.ttf")}</style>' +
      '<h1>Kept</h1>';
    const out = serializeEditedStory(root, []);
    expect(out).toContain('<h1>Kept</h1>');
    expect(out).not.toContain('data-mx-tw');
    expect(out).not.toContain('.tw{display:flex}');
    expect(out).not.toContain('data-mx-floating');
    expect(out).not.toContain('data-mx-fonts');
    expect(out).not.toContain('@font-face');
  });

  it('preserves edited text and the story style block', () => {
    const out = serializeEditedStory(makeRoot(), []);
    expect(out).toContain('EDITED HEADLINE');
    expect(out).toContain('.s{color:blue}');
  });

  it('restores each chart embed to an empty placeholder with its authored size', () => {
    const out = serializeEditedStory(makeRoot(), []);
    expect(out).toContain('data-question-id="5"');
    expect(out).toContain('width:100%;height:420px');
    // rendered chart DOM and the size-snapshot attr are gone
    expect(out).not.toContain('rendered-chart');
    expect(out).not.toContain('data-mx-osz');
  });

  it('restores an INLINE question embed to an empty placeholder with its authored size + def', () => {
    const out = serializeEditedStory(makeRoot(), []);
    expect(out).toContain('data-question-inline');
    expect(out).toContain('width:100%;height:200px');
    // the inline def survives, the rendered chart + size-snapshot do not
    expect(out).toContain('SELECT 1');
    expect(out).not.toContain('inline echarts junk');
  });

  it('strips all contenteditable attributes', () => {
    const out = serializeEditedStory(makeRoot(), []);
    expect(out).not.toContain('contenteditable');
  });

  it('preserves an inline <Number> placeholder — incl. a query EDITED via the footnote popover', () => {
    // The popover edit writes the new query onto the placeholder via setAttribute(rawJSON); on Save
    // serialize() must keep it (empty span, attr intact) so the edit persists into content.story.
    const root = makeRoot();
    const span = root.querySelector('[data-number-inline]') as HTMLElement;
    span.setAttribute('data-number-inline', JSON.stringify({ query: 'SELECT 2 AS v', connection: 'duck' }));
    const out = serializeEditedStory(root, []);
    expect(out).toContain('data-number-inline');
    expect(out).toContain('SELECT 2 AS v');   // the EDITED query survived
    expect(out).not.toContain('SELECT 1 AS v'); // the old one is gone
  });

  it('re-injects hoisted @import font lines into the first style block', () => {
    const imports = ["@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue');"];
    const out = serializeEditedStory(makeRoot(), imports);
    expect(out).toContain("@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue');");
    // it lands before the story's own rule, inside a <style>
    expect(out.indexOf('@import')).toBeLessThan(out.indexOf('.s{color:blue}'));
  });
});

/**
 * AgentHtml renders `sanitizeAgentHtml(html)` — which wraps the authored story in a single
 * `<div data-mx-story-root>` — into the iframe <body>, and calls serializeEditedStory(doc.body).
 * The body ALSO holds non-story siblings (the hidden embed-root host, and Ark popover/menu DOM
 * that inline widgets portal to the body). Two historical bugs bloated content.story on every save:
 *   (1) serialize returned the WHOLE body incl. the wrapper → each load+save re-nested the story;
 *   (2) it captured the body-level Ark popover portals as if they were prose.
 * These tests pin the fixed behaviour: serialize the wrapper's CONTENT only, collapse any nested
 * wrappers accumulated by prior saves, and strip leaked Ark runtime DOM ([data-scope]).
 */
describe('serializeEditedStory — story-root wrapper + leaked-DOM handling', () => {
  /** doc.body after a normal render: the story wrapped in <div data-mx-story-root>. */
  function bodyWithWrapper(inner: string): HTMLDivElement {
    const body = document.createElement('div');
    body.innerHTML = `<div data-mx-story-root>${inner}</div>`;
    return body;
  }

  it('strips the data-mx-story-root wrapper, keeping only its content', () => {
    const out = serializeEditedStory(bodyWithWrapper('<h1>REAL HEADLINE</h1><p>body</p>'), []);
    expect(out).toContain('REAL HEADLINE');
    expect(out).toContain('<p>body</p>');
    expect(out).not.toContain('data-mx-story-root');
  });

  it('collapses nested data-mx-story-root wrappers left by prior buggy saves', () => {
    const nested = '<div data-mx-story-root><div data-mx-story-root><div data-mx-story-root>' +
      '<h1>ONCE</h1></div></div></div>';
    const out = serializeEditedStory(bodyWithWrapper(nested), []);
    expect(out).not.toContain('data-mx-story-root');
    // the real content survives exactly once
    expect(out.match(/ONCE/g)?.length).toBe(1);
  });

  it('excludes Ark popover DOM portaled to the body (sibling of the story wrapper)', () => {
    const body = document.createElement('div');
    body.innerHTML =
      '<div data-mx-story-root><p>prose</p>' +
      '<span data-number-inline="{&quot;query&quot;:&quot;SELECT 1 AS v&quot;}">$1</span></div>' +
      // leaked live popover, portaled to the body next to the wrapper
      '<div data-scope="popover" data-part="positioner"><div data-part="content">' +
      '<pre aria-label="inline number query">SELECT leaked_query</pre></div></div>';
    const out = serializeEditedStory(body, []);
    expect(out).toContain('prose');
    expect(out).toContain('data-number-inline');
    expect(out).not.toContain('leaked_query');
    expect(out).not.toContain('inline number query');
    expect(out).not.toContain('data-scope');
  });

  it('self-heals a story with popover DOM already baked into its content', () => {
    // Existing corrupted files: the leaked popover is now INSIDE the saved content (it gets
    // re-wrapped on load). It carries Ark's data-scope, so serialize strips it on the next save.
    const inner = '<p>kept prose</p>' +
      '<div data-scope="popover" data-part="content"><pre aria-label="inline number query">SELECT baked_leak</pre></div>' +
      '<span data-number-inline="{&quot;query&quot;:&quot;SELECT 1 AS v&quot;}">$1</span>';
    const out = serializeEditedStory(bodyWithWrapper(inner), []);
    expect(out).toContain('kept prose');
    expect(out).toContain('data-number-inline');
    expect(out).not.toContain('baked_leak');
    expect(out).not.toContain('data-scope');
  });

  it('still restores placeholders and re-injects imports when scoped to the wrapper', () => {
    const inner = '<style>.s{color:blue}</style>' +
      '<div data-question-id="5" data-mx-osz="width:100%;height:420px">' +
      '<div class="rendered-chart">junk</div></div>';
    const out = serializeEditedStory(bodyWithWrapper(inner), ["@import url('x');"]);
    expect(out).toContain('data-question-id="5"');
    expect(out).toContain('width:100%;height:420px');
    expect(out).not.toContain('rendered-chart');
    expect(out).not.toContain('data-mx-osz');
    expect(out).toContain("@import url('x');");
  });
});
