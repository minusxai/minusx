/**
 * Story design-system components — codec tests.
 *
 * Components are compile-time only: `<Pill tone="bad">…</Pill>` in agent markup becomes a
 * static HTML container (Tailwind recipe + data-c stamp) in content.story, and the reverse
 * pass rebuilds the component call from the stamp. The invariants that matter:
 *  - full agent-markup round trip (markup → content → markup) is lossless;
 *  - WYSIWYG text edits inside a component survive the reverse pass (text lives in children);
 *  - same-tag nesting depth-matches (Card in Card);
 *  - embeds inside components keep working (placeholders emitted, assets collected).
 */
import { emitStoryComponent, reverseStoryComponents } from '../story-components';
import { parseStoryJsx, buildStoryJsx } from '../story-v2';
import { fileToMarkup, markupToContent } from '../file-markup';
import type { StoryContent } from '@/lib/types';

describe('emitStoryComponent', () => {
  it('emits the container tag with data-c stamp and class recipe', () => {
    const html = emitStoryComponent('Pill', { tone: 'bad' }, '▼ 3%')!;
    expect(html).toContain('<span');
    expect(html).toContain('data-c="Pill"');
    expect(html).toContain('data-tone="bad"');
    expect(html).toContain('bg-red-100');
    expect(html).toContain('>▼ 3%</span>');
  });
  it('defaults unknown/missing prop values to the first allowed value', () => {
    expect(emitStoryComponent('Pill', {}, 'x')).toContain('data-tone="neutral"');
    expect(emitStoryComponent('Pill', { tone: 'sparkly' }, 'x')).toContain('data-tone="neutral"');
    expect(emitStoryComponent('Grid', { cols: 3 }, 'x')).toContain('data-cols="3"');
    expect(emitStoryComponent('Grid', { cols: 9 }, 'x')).toContain('data-cols="3"');
  });
  it('returns null for unknown component names', () => {
    expect(emitStoryComponent('Widget', {}, 'x')).toBeNull();
  });
});

describe('parseStoryJsx with components', () => {
  it('compiles nested components + embeds to static HTML and collects assets', () => {
    const r = parseStoryJsx(
      '<div data-design="tw" class="@container"><Grid cols={2}><Card><Stat>' +
      '<StatLabel>Revenue</StatLabel><StatValue>$3.02M</StatValue><StatDelta tone="up">▲ 6.3%</StatDelta>' +
      '</Stat></Card><Card><Question id={14} height="300px" /></Card></Grid></div>',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assets).toEqual([14]);
    expect(r.value.html).toContain('data-c="Grid"');
    expect(r.value.html).toContain('data-cols="2"');
    expect(r.value.html).toContain('data-c="StatDelta"');
    expect(r.value.html).toContain('data-question-id="14"');
    expect(r.value.html).toContain('text-emerald-600'); // up-tone recipe
    expect(r.value.html).not.toContain('<Grid'); // fully compiled, no component tags in stored HTML
  });
});

describe('reverseStoryComponents', () => {
  it('rebuilds the component call and drops the derived class attribute', () => {
    const jsx = reverseStoryComponents(
      '<span data-c="Pill" data-tone="bad" class="inline-block bg-red-100">▼ 3%</span>',
    );
    expect(jsx).toBe('<Pill tone="bad">▼ 3%</Pill>');
  });
  it('depth-matches same-tag nesting (Card in Card)', () => {
    const jsx = reverseStoryComponents(
      '<div data-c="Card" class="x"><div class="plain"><div data-c="Card" class="x">inner</div></div></div>',
    );
    expect(jsx).toBe('<Card><div class="plain"><Card>inner</Card></div></Card>');
  });
  it('leaves unknown data-c values and plain HTML untouched', () => {
    const html = '<div data-c="Mystery" class="x">y</div><p class="keep">z</p>';
    expect(reverseStoryComponents(html)).toBe(html);
  });
});

describe('full agent round trip', () => {
  const MARKUP =
    '<description>d</description>\n<story><div data-design="tw" class="@container">' +
    '<Section><Eyebrow>01 · GROWTH</Eyebrow><Grid cols={3}>' +
    '<Card><Stat><StatLabel>Orders</StatLabel><StatValue>39.88k</StatValue>' +
    '<StatDelta tone="up">▲ 6.2%</StatDelta></Stat></Card>' +
    '<Card><Question id={14} height="300px" /></Card>' +
    '<Card><Callout tone="warn"><Pill tone="bad">▼ $2.0m</Pill> below budget</Callout></Card>' +
    '</Grid></Section></div></story>';

  it('markup → content → markup is lossless for components', () => {
    const parsed = markupToContent('story', MARKUP);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const content = parsed.content as StoryContent;
    expect(content.story).toContain('data-c="Callout"');
    const emitted = fileToMarkup('story', content);
    expect(emitted).toContain('<Section>');
    expect(emitted).toContain('<Grid cols={3}>');
    expect(emitted).toContain('<StatDelta tone="up">▲ 6.2%</StatDelta>');
    expect(emitted).toContain('<Pill tone="bad">▼ $2.0m</Pill>');
    expect(emitted).toContain('<Question id={14}');
    expect(emitted).not.toContain('data-c='); // stamps never reach the agent
    expect(emitted).not.toContain('class="grid'); // recipes never reach the agent
  });

  it('a WYSIWYG text edit inside a component survives the reverse pass', () => {
    const parsed = markupToContent('story', MARKUP);
    if (!parsed.ok) throw new Error('parse failed');
    const content = parsed.content as StoryContent;
    // User edits the pill text in the browser; the DOM (and thus stored HTML) changes in place.
    const edited = { ...content, story: content.story!.replace('▼ $2.0m', '▼ $2.4m') };
    const emitted = fileToMarkup('story', edited);
    expect(emitted).toContain('<Pill tone="bad">▼ $2.4m</Pill>');
  });
});

describe('buildStoryJsx ordering', () => {
  it('reverses embeds inside components (placeholders first, then containers)', () => {
    const stored =
      '<div data-c="Card" class="x"><div data-question-id="7" style="width:100%;height:300px"></div></div>';
    const jsx = buildStoryJsx({ story: stored } as StoryContent);
    expect(jsx).toBe('<Card><Question id={7} /></Card>');
  });
});
