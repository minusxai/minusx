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
