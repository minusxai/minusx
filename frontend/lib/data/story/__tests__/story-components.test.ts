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

// Component markup only compiles for LEGACY stories now (new `format:'jsx'` stories reject the
// old component names) — legacy-ness derives from the EXISTING stored content, so these
// round-trip invariants pass a legacy stored body as the existing content.
const LEGACY_EXISTING = { description: null, story: '<div class="story"><h1>old</h1></div>' };

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
    const parsed = markupToContent('story', MARKUP, LEGACY_EXISTING);
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
    const parsed = markupToContent('story', MARKUP, LEGACY_EXISTING);
    if (!parsed.ok) throw new Error('parse failed');
    const content = parsed.content as StoryContent;
    // User edits the pill text in the browser; the DOM (and thus stored HTML) changes in place.
    const edited = { ...content, story: content.story!.replace('▼ $2.0m', '▼ $2.4m') };
    const emitted = fileToMarkup('story', edited);
    expect(emitted).toContain('<Pill tone="bad">▼ $2.4m</Pill>');
  });
});

describe('higher-order components (the beautiful-by-default layer)', () => {
  it('Headline compiles to an h2 with the display-type recipe baked in', () => {
    const html = emitStoryComponent('Headline', {}, 'Orders scaled 128x.')!;
    expect(html).toMatch(/^<h2\b/);
    expect(html).toContain('data-c="Headline"');
    expect(html).toContain('font-semibold');
    expect(html).toContain('@2xl:text-6xl'); // responsive display size is the recipe's job, not the agent's
  });

  it('Standfirst is the serif italic lede', () => {
    const html = emitStoryComponent('Standfirst', {}, 'A leadership view…')!;
    expect(html).toContain('font-serif');
    expect(html).toContain('italic');
  });

  it('the accent channel: Eyebrow/Headline-strong/Takeaways read --st-accent with a default', () => {
    expect(emitStoryComponent('Eyebrow', {}, 'x')).toContain('var(--st-accent,#0f766e)');
    expect(emitStoryComponent('Headline', {}, 'x')).toContain('var(--st-accent,#0f766e)');
    expect(emitStoryComponent('Takeaways', {}, 'x')).toContain('var(--st-accent,#0f766e)');
  });

  it('PageHeader/PageFooter are the page furniture bands (flex-between, tracked small caps)', () => {
    expect(emitStoryComponent('PageHeader', {}, '<span>L</span><span>R</span>')).toContain('justify-between');
    expect(emitStoryComponent('PageFooter', {}, '<span>L</span><span>R</span>')).toContain('border-t');
  });

  it('Takeaways styles its own nested list, entity-escaped in the stored attr (PR #575 rule)', () => {
    const html = emitStoryComponent('Takeaways', {}, '<ul><li>x</li></ul>')!;
    expect(html).toContain('[&amp;_ul]:list-disc'); // & escaped at rest; extraction decodes it back
    expect(html).not.toMatch(/class="[^"]*&(?!amp;|gt;|lt;|quot;)/); // no raw & inside the attr
  });

  it('FigurePlate frames a chart and styles a trailing caption paragraph (escaped at rest)', () => {
    const html = emitStoryComponent('FigurePlate', {}, '<div data-question-id="1"></div><p>caption</p>')!;
    expect(html).toContain('data-c="FigurePlate"');
    expect(html).toContain('[&amp;&gt;p]:'); // > never appears raw inside a stored attribute
  });
});

describe('class prop — customization without leaving the component system', () => {
  it('merges custom classes after the recipe and stamps them for the reverse pass', () => {
    const html = emitStoryComponent('Card', { class: 'bg-indigo-50 border-indigo-200' }, 'x')!;
    expect(html).toContain('data-cls="bg-indigo-50 border-indigo-200"');
    expect(html).toMatch(/class="[^"]*rounded-2xl[^"]*bg-indigo-50 border-indigo-200"/); // recipe first, custom last
  });

  it('reverses back to a class prop (recipe classes dropped, custom kept)', () => {
    const html = emitStoryComponent('Pill', { tone: 'good', class: 'text-base' }, 'up')!;
    expect(reverseStoryComponents(html)).toBe('<Pill tone="good" class="text-base">up</Pill>');
  });

  it('round-trips through the full agent markup pipeline', () => {
    const markup =
      '<description>d</description>\n<story><div data-design="tw" class="@container">' +
      '<Section><Headline class="text-center">Claim.</Headline>' +
      '<FigurePlate><Question id={14} height="300px" /><p>cap</p></FigurePlate></Section></div></story>';
    const parsed = markupToContent('story', markup, LEGACY_EXISTING);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const emitted = fileToMarkup('story', parsed.content as StoryContent);
    expect(emitted).toContain('<Headline class="text-center">Claim.</Headline>');
    expect(emitted).toContain('<FigurePlate><Question id={14}');
    expect(emitted).not.toContain('data-c=');
  });

  it('escapes/ignores malformed class values safely (no attribute breakout)', () => {
    const html = emitStoryComponent('Card', { class: 'a" onmouseover="x' }, 'x')!;
    expect(html).not.toContain('onmouseover="x"');
  });

  it('the reverse pass only emits ALLOWLISTED enum values (forged data-tone falls back)', () => {
    const jsx = reverseStoryComponents(
      '<span data-c="Pill" data-tone="sparkly" class="x">y</span>',
    );
    expect(jsx).toBe('<Pill tone="neutral">y</Pill>'); // unknown value → the prop default
  });

  it('the reverse pass never un-escapes a quote into the class prop (forged data-cls)', () => {
    // A hand-forged stored attr (JSON code view) with an entity-encoded quote must not break
    // out of the quoted class prop in the generated agent markup.
    const jsx = reverseStoryComponents(
      '<div data-c="Card" data-cls="a&quot; onload=&quot;x" class="rounded-2xl">y</div>',
    );
    expect(jsx).toBe('<Card class="a onload=x">y</Card>'); // quotes stripped, no attr injection
  });
});

describe('buildStoryJsx ordering', () => {
  it('reverses embeds inside components (placeholders first, then containers)', () => {
    const stored =
      '<div data-c="Card" class="x"><div data-question-id="7" style="width:100%;height:300px"></div></div>';
    const jsx = buildStoryJsx({ story: stored } as StoryContent);
    // non-default height is preserved through the reverse pass (was dropped before)
    expect(jsx).toBe('<Card><Question id={7} height="300px" /></Card>');
  });
});
