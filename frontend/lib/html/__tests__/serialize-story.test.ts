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

  it('strips all contenteditable attributes', () => {
    const out = serializeEditedStory(makeRoot(), []);
    expect(out).not.toContain('contenteditable');
  });

  it('re-injects hoisted @import font lines into the first style block', () => {
    const imports = ["@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue');"];
    const out = serializeEditedStory(makeRoot(), imports);
    expect(out).toContain("@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue');");
    // it lands before the story's own rule, inside a <style>
    expect(out.indexOf('@import')).toBeLessThan(out.indexOf('.s{color:blue}'));
  });
});
