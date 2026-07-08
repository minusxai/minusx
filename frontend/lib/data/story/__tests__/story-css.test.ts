/**
 * Story design-system CSS — contract tests.
 *
 * A story that opts in via `data-design="tw"` on its root wrapper gets exactly the Tailwind
 * utilities it uses compiled to a per-story stylesheet; a legacy story (no marker) gets null,
 * so Tailwind (and its preflight reset) can never alter how existing stories render.
 * `compiledCss` is server-managed: never part of the agent's markup in either direction.
 */
import { hasDesignSystemMarker, extractClassCandidates } from '../story-css';
import { compileStoryCss, withCompiledStoryCss } from '../story-css.server';
import { fileToMarkup, markupToContent } from '../file-markup';

const TW_STORY =
  '<div class="mx-story" data-design="tw">' +
  '<h1 class="text-3xl font-bold text-slate-900">Title</h1>' +
  '<div class="grid grid-cols-3 gap-4">' +
  '<span class="mt-2.5 rounded-full bg-red-100 px-2.5 text-[13px] dark:bg-red-950">pill</span>' +
  '</div></div>';

const LEGACY_STORY =
  '<style>.story-sc .card { border: 1px solid #eee; }</style>' +
  '<div class="story-sc"><div class="card kpi-grid">legacy</div></div>';

describe('hasDesignSystemMarker', () => {
  it('detects the root marker (double or single quotes)', () => {
    expect(hasDesignSystemMarker(TW_STORY)).toBe(true);
    expect(hasDesignSystemMarker("<div data-design='tw'>x</div>")).toBe(true);
  });
  it('is false for legacy stories, other values, and empty input', () => {
    expect(hasDesignSystemMarker(LEGACY_STORY)).toBe(false);
    expect(hasDesignSystemMarker('<div data-design="v3">x</div>')).toBe(false);
    expect(hasDesignSystemMarker('')).toBe(false);
    expect(hasDesignSystemMarker(null)).toBe(false);
    expect(hasDesignSystemMarker(undefined)).toBe(false);
  });
});

describe('extractClassCandidates', () => {
  it('collects every class token, deduped and sorted (deterministic)', () => {
    const c = extractClassCandidates('<div class="b a"><span class="a c">x</span></div>');
    expect(c).toEqual(['a', 'b', 'c']);
  });
  it('keeps arbitrary-value utilities intact and handles single quotes', () => {
    const c = extractClassCandidates("<span class='text-[13px] w-[calc(100%-2rem)]'>x</span>");
    expect(c).toContain('text-[13px]');
    expect(c).toContain('w-[calc(100%-2rem)]');
  });
  it('ignores non-class attributes and text content', () => {
    const c = extractClassCandidates('<div data-x="flex" title="grid">bg-red-100</div>');
    expect(c).toEqual([]);
  });

  it('decodes entity-escaped arbitrary-variant classes (stored attrs escape &/>/<)', () => {
    // Component recipes like [&>p]:mt-3 are stored entity-escaped (escAttr) so tag scanners
    // don't break; extraction must decode them back to the real Tailwind candidates.
    const c = extractClassCandidates('<div class="[&amp;&gt;p]:mt-3 [&amp;_ul]:list-disc rounded-2xl">x</div>');
    expect(c).toContain('[&>p]:mt-3');
    expect(c).toContain('[&_ul]:list-disc');
    expect(c).toContain('rounded-2xl');
  });
});

describe('compileStoryCss', () => {
  it('returns null for legacy stories and empty input (no marker, no stylesheet)', async () => {
    expect(await compileStoryCss(LEGACY_STORY)).toBeNull();
    expect(await compileStoryCss('')).toBeNull();
    expect(await compileStoryCss(null)).toBeNull();
    expect(await compileStoryCss(undefined)).toBeNull();
  });

  it('compiles exactly the used utilities for a marked story (incl. arbitrary values)', async () => {
    const css = await compileStoryCss(TW_STORY);
    expect(css).toBeTruthy();
    expect(css).toContain('.grid-cols-3');
    expect(css).toContain('.bg-red-100');
    expect(css).toContain('.text-\\[13px\\]');
    // Unused utilities are not emitted — this is a per-story build, not a full framework dump.
    expect(css).not.toContain('.bg-emerald-');
  });

  it('supports class-based dark mode (iframe html gets .dark, not prefers-color-scheme)', async () => {
    const css = await compileStoryCss(TW_STORY);
    expect(css).toMatch(/\.dark/); // dark:bg-red-950 must key off the .dark class
  });

  it('includes the preflight/base layer for marked stories', async () => {
    const css = (await compileStoryCss(TW_STORY))!;
    expect(css).toContain('box-sizing');
  });

  it('is deterministic for the same document', async () => {
    const a = await compileStoryCss(TW_STORY);
    const b = await compileStoryCss(TW_STORY);
    expect(a).toEqual(b);
  });

  // End-to-end for component recipes: emitted (entity-escaped) arbitrary-variant classes must
  // survive storage → extraction → compile and produce real descendant rules.
  it('compiles entity-escaped arbitrary-variant recipes (Takeaways/FigurePlate descendant styling)', async () => {
    const stored = '<div data-design="tw"><div class="[&amp;_ul]:list-disc [&amp;&gt;p]:mt-3">x</div></div>';
    const css = (await compileStoryCss(stored))!;
    expect(css).toContain('list-style-type: disc');
    expect(css).toMatch(/>\s*p/); // the child-combinator selector made it into the CSS
  });

  // The story iframe also carries the app's mirrored stylesheet (reset included) UN-layered,
  // and un-layered CSS beats @layer CSS regardless of order — so layered utilities silently
  // lose every property the reset touches (padding/margins/font-size: the "everything is
  // cramped" bug). The compiled output must be FLAT (no @layer wrappers/statements) so it
  // competes by document order, where it wins (injected after the mirror).
  it('emits flat CSS — no cascade layers to lose against the un-layered app mirror', async () => {
    const css = (await compileStoryCss(TW_STORY))!;
    expect(css).not.toContain('@layer');
    // The rules themselves survive the unwrapping, at top level.
    expect(css).toContain('.grid-cols-3');
    expect(css).toContain('.mt-2\\.5');
    expect(css).toMatch(/\.bg-red-100\s*\{/);
    // Nested at-rules (media/container/supports) survive inside the flattened output.
    expect(css).toContain('@property');
  });
});

describe('withCompiledStoryCss', () => {
  it('attaches compiledCss for marked stories and discards any client-sent value', async () => {
    const out = await withCompiledStoryCss({ story: TW_STORY, compiledCss: 'CLIENT GARBAGE' });
    expect(out.compiledCss).toBeTruthy();
    expect(out.compiledCss).not.toBe('CLIENT GARBAGE');
    expect(out.story).toBe(TW_STORY);
  });
  it('sets compiledCss to null for legacy stories (even if the client sent one)', async () => {
    const out = await withCompiledStoryCss({ story: LEGACY_STORY, compiledCss: 'CLIENT GARBAGE' });
    expect(out.compiledCss).toBeNull();
  });
});

describe('compiledCss never crosses the agent-markup boundary', () => {
  it('fileToMarkup omits compiledCss from story markup', () => {
    const markup = fileToMarkup('story', {
      description: 'd',
      story: TW_STORY,
      compiledCss: '.SHOULD-NOT-LEAK{}',
      parameterValues: null,
    });
    expect(markup).not.toContain('compiledCss');
    expect(markup).not.toContain('SHOULD-NOT-LEAK');
  });

  it('markupToContent drops an agent-authored <compiledCss> element', () => {
    const r = markupToContent(
      'story',
      '<description>d</description><story><div data-design="tw" class="grid">x</div></story>' +
      '<compiledCss>{`.hax{}`}</compiledCss>',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect('compiledCss' in r.content).toBe(false);
  });
});
