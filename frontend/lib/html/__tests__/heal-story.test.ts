/**
 * healStoryHtml — heals a STORED `content.story` string that was bloated by the historical
 * serialize bugs: nested <div data-mx-story-root> wrappers (one added per save) and leaked Ark
 * popover DOM (portaled to the iframe body, then baked into the saved content). It reuses the exact
 * fixed serializeEditedStory logic so a batch-healed file is byte-identical to what the live editor
 * would now save. Runs in Node (jsdom) — used by the heal-stories backfill.
 */
import { healStoryHtml } from '@/lib/html/heal-story.server';

describe('healStoryHtml', () => {
  it('collapses nested story-root wrappers and strips leaked popover DOM, keeping real content', () => {
    const bloated =
      '<div data-mx-story-root><div data-mx-story-root>' +
      '<style>.s{color:blue}</style>' +
      '<h1>Revenue report</h1><p>MRR is ' +
      '<span data-number-inline="{&quot;query&quot;:&quot;SELECT 1 AS v&quot;,&quot;connection&quot;:&quot;duck&quot;}"></span></p>' +
      // leaked popover baked into the saved content
      '<div data-scope="popover" data-part="positioner"><div data-part="content">' +
      '<pre aria-label="inline number query">SELECT leaked_query</pre></div></div>' +
      '</div></div>';

    const { html, changed } = healStoryHtml(bloated);

    expect(changed).toBe(true);
    expect(html).not.toContain('data-mx-story-root');
    expect(html).not.toContain('data-scope');
    expect(html).not.toContain('leaked_query');
    // authored content + the inline-number placeholder survive
    expect(html).toContain('Revenue report');
    expect(html).toContain('.s{color:blue}');
    expect(html).toContain('data-number-inline');
    expect(html).toContain('SELECT 1 AS v');
  });

  it('is idempotent — healing already-clean content reports no change', () => {
    const clean = '<h1>Clean</h1><p>Nothing to fix.</p>';
    const { html, changed } = healStoryHtml(clean);
    expect(changed).toBe(false);
    expect(html).toContain('Clean');
  });

  it('reports a large size reduction for the real-world bloat pattern', () => {
    // 20 leaked popover panels + a triple-nested wrapper — the shape seen in production.
    const panels = Array.from({ length: 20 }, (_, i) =>
      `<div data-scope="popover" data-part="content"><pre aria-label="inline number query">SELECT ${i}</pre></div>`,
    ).join('');
    const bloated = `<div data-mx-story-root><div data-mx-story-root><div data-mx-story-root>` +
      `<p>real</p>${panels}</div></div></div>`;
    const { html, changed } = healStoryHtml(bloated);
    expect(changed).toBe(true);
    expect(html).toContain('real');
    expect(html).not.toContain('data-scope');
    expect(html.length).toBeLessThan(bloated.length / 2);
  });
});
