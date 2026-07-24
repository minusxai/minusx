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
import { STORY_THEMES } from '../story-themes';

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

// Phase 0 hardening (Story_Design_V2 §3): a malformed class token must never fail the compile —
// bad candidates are bisected out and the survivors' CSS is returned. Tailwind v4's build()
// throws on tokens like `w-[calc(100%` (unbalanced bracket); before hardening that threw all
// the way up and failed the whole save.
describe('compileStoryCss hardening — malformed candidates never throw', () => {
  const BROKEN_STORY =
    '<div class="mx-story" data-design="tw">' +
    '<p class="bg-amber-100 w-[calc(100% text-slate-900">broken token amid good ones</p></div>';

  it('survives a malformed arbitrary-value token and still compiles the good utilities', async () => {
    const css = await compileStoryCss(BROKEN_STORY);
    expect(css).toBeTruthy();
    expect(css).toContain('.bg-amber-100');
    expect(css).toContain('.text-slate-900');
  });

  it('returns base-only CSS when every candidate is malformed (never throws, never null for marked stories)', async () => {
    const allBad = '<div data-design="tw"><p class="w-[calc(100% h-[min(50">x</p></div>';
    await expect(compileStoryCss(allBad)).resolves.not.toBeNull();
  });
});

// The salvage guard itself, tested with an injected throwing build (no current Tailwind input
// throws — the guard exists so a future build() throw can never fail a save).
describe('buildSalvaging', () => {
  const buildThrowingOn = (bad: string[]) => (candidates: string[]) => {
    if (candidates.some(c => bad.includes(c))) throw new Error(`Cannot represent ${bad[0]}`);
    return candidates.map(c => `.${c}{}`).join('');
  };

  it('drops exactly the throwing candidates and compiles the rest', async () => {
    const { buildSalvaging } = await import('../story-css.server');
    const r = buildSalvaging(buildThrowingOn(['bad-1']), ['a', 'bad-1', 'b']);
    expect(r.css).toBe('.a{}.b{}');
    expect(r.dropped).toEqual(['bad-1']);
  });

  it('handles multiple bad candidates scattered through the set', async () => {
    const { buildSalvaging } = await import('../story-css.server');
    const r = buildSalvaging(buildThrowingOn(['x', 'y']), ['x', 'a', 'y', 'b', 'c']);
    expect(r.css).toBe('.a{}.b{}.c{}');
    expect(r.dropped.sort()).toEqual(['x', 'y']);
  });

  it('never throws even when every candidate (and the empty build) fails', async () => {
    const { buildSalvaging } = await import('../story-css.server');
    const r = buildSalvaging(() => { throw new Error('always'); }, ['a', 'b']);
    expect(r.css).toBe('');
    expect(r.dropped.sort()).toEqual(['a', 'b']);
  });
});

// ── jsx-format stories (Story_Design_V2 §3) ────────────────────────────────────────────────
describe('jsx-format stories — className candidates + always-compile', () => {
  const JSX_STORY =
    '<div className="p-6 bg-card"><Card className="rounded-xl">' +
    "<span className='text-[13px] text-muted-foreground'>x</span></Card></div>";

  it('extractClassCandidates matches className="…" and className=\'…\' (JSX spelling)', () => {
    const c = extractClassCandidates(JSX_STORY);
    expect(c).toContain('p-6');
    expect(c).toContain('bg-card');
    expect(c).toContain('rounded-xl');
    expect(c).toContain('text-[13px]');
    expect(c).toContain('text-muted-foreground');
  });

  // Phase 6a: with the app-CSS mirror shrunk to fonts, embed chrome inside LEGACY marked
  // stories has exactly one style source — the compiled sheet. The recipe union (kit +
  // EMBED_CHROME_FILES classes) therefore applies to marked legacy stories too, compiled
  // against the token layer so token-backed utilities (bg-muted, animate-spin ring colors)
  // resolve. Legacy stories keep skipping the banned-candidate guard (frozen semantics).
  it('marked LEGACY stories get the recipe union + token layer (embeds keep their chrome)', async () => {
    const css = await compileStoryCss('<div data-design="tw" class="p-4">legacy with embeds</div>');
    expect(css).toContain('animate-spin');   // embed-chrome class, NOT in the story markup
    expect(css).toContain('--background');   // token layer present so token utilities resolve
  });

  // Same visual bar as the app build (buildAppThemeCss): the stock shadcn --chart-1..5 would
  // silently recolor embedded charts in unthemed/legacy stories (VegaChart reads those tokens).
  // The NEUTRAL story bodies carry the app palette; [data-theme] blocks still override.
  it('story neutral bodies keep the APP chart palette (no silent embed recolor)', async () => {
    const css = (await compileStoryCss('<div data-design="tw" class="p-2">x</div>'))!;
    expect(css).toContain('--chart-1: #16a085');
    expect(css).not.toMatch(/:root[^}]*--chart-1: oklch/);
  });

  it('compileStoryCss compiles with force even without the data-design marker', async () => {
    const css = await compileStoryCss('<div className="grid grid-cols-3 bg-red-100">x</div>', { force: true });
    expect(css).toBeTruthy();
    expect(css).toContain('.grid-cols-3');
    expect(css).toContain('.bg-red-100');
  });

  it('withCompiledStoryCss ALWAYS compiles a format:"jsx" story (no marker needed)', async () => {
    const out = await withCompiledStoryCss({ story: '<div className="p-4 bg-red-100">x</div>', format: 'jsx' as const });
    expect(out.compiledCss).toBeTruthy();
    expect(out.compiledCss).toContain('.bg-red-100');
  });

  it('withCompiledStoryCss keeps the marker gate for legacy stories (no format)', async () => {
    const out = await withCompiledStoryCss({ story: '<div class="p-4 bg-red-100">legacy</div>' });
    expect(out.compiledCss).toBeNull();
  });
});

// §3 token layer: jsx stories compile against the shadcn preamble (token utilities like
// bg-card resolve via @theme inline) UNIONED with the registry recipe classes — the shadcn
// component sources use classes (rounded-xl, border, shadow-sm, …) that never appear in the
// story's own markup, so without the base sheet a <Card> renders unstyled.
describe('shadcn token preamble + recipe base sheet (format:jsx)', () => {
  it('compiles token utilities used in story markup (bg-card, text-muted-foreground)', async () => {
    const css = (await compileStoryCss('<div className="bg-card text-muted-foreground">x</div>', { force: true }))!;
    expect(css).toContain('.bg-card');
    expect(css).toContain('var(--card'); // @theme inline: utilities reference the raw token var
    expect(css).toContain('.text-muted-foreground');
  });

  it('includes neutral :root/.dark token defaults so themeless stories look right', async () => {
    const css = (await compileStoryCss('<div className="bg-card">x</div>', { force: true }))!;
    expect(css).toMatch(/:root\s*\{[^}]*--card:/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--card:/);
    expect(css).toMatch(/--radius:/);
  });

  it('unions the shadcn recipe classes so component chrome is styled without appearing in markup', async () => {
    // A jsx story using <Card> only — "rounded-xl"/"shadow-sm" come from the Card recipe, not the story.
    const css = (await compileStoryCss('<Card className="p-0">x</Card>', { force: true }))!;
    expect(css).toContain('.rounded-xl');
    expect(css).toContain('.shadow-sm');
  });

  // CONTRACT CHANGE (Phase 6a): legacy marked stories now union the recipe classes too — after
  // the mirror shrink the compiled sheet is the embeds' only style source, so "lean" would mean
  // "unstyled embed chrome". The kit chrome classes therefore appear in legacy compiles as well.
  it('unions recipe classes for legacy marked stories (post-6a: embeds have no other source)', async () => {
    const css = (await compileStoryCss('<div data-design="tw" class="p-2">x</div>'))!;
    expect(css).toContain('.rounded-xl');
  });
});

// Banned-CSS candidate filter (Story_Design_V2 §4): banned Tailwind candidates are dropped
// BEFORE compile as a SEPARATE guard step — never absorbed by buildSalvaging's error-bisect.
// Proof of separation: `fixed`/`sticky` compile perfectly fine in Tailwind, so their absence
// from the output can only come from the guard, not from a compile failure.
describe('compileStoryCss — banned candidate filter (format:jsx)', () => {
  it('drops fixed/sticky candidates (including variants) from jsx-story compiles', async () => {
    const css = (await compileStoryCss(
      '<div className="fixed md:sticky p-4">x</div>', { force: true },
    ))!;
    expect(css).not.toMatch(/position:\s*fixed/);
    expect(css).not.toMatch(/position:\s*sticky/);
    expect(css).toContain('.p-4'); // siblings survive
  });

  it('drops external-url arbitrary-value candidates; data: URIs pass', async () => {
    const css = (await compileStoryCss(
      `<div className="bg-[url(https://evil.example/x.png)] bg-[url(data:image/svg+xml;base64,PHN2Zy8+)] p-2">x</div>`,
      { force: true },
    ))!;
    expect(css).not.toContain('evil.example');
    expect(css).toContain('data:image/svg+xml');
    expect(css).toContain('.p-2');
  });

  it('legacy marked stories are NOT candidate-filtered (frozen pipeline keeps its CSS live)', async () => {
    const css = (await compileStoryCss('<div data-design="tw" class="fixed p-2">x</div>'))!;
    expect(css).toMatch(/position:\s*fixed/);
  });
});

// Theme token blocks (Story_Design_V2 §5): every jsx story's compiledCss ships ALL SIX
// `[data-theme="<name>"]` variable blocks, so switching a story's theme is an attribute
// change only — instant preview, no recompile. Appended AFTER the compiled sheet so the
// attribute-scoped blocks beat the `:root`/`.dark` neutral defaults on document order.
describe('compileStoryCss — theme token blocks (format:jsx)', () => {
  it('ships all six [data-theme] blocks, each with its own --primary', async () => {
    const css = (await compileStoryCss('<p className="p-2">x</p>', { force: true }))!;
    for (const t of STORY_THEMES) {
      expect(css).toContain(`[data-theme="${t.name}"]`);
    }
    const nocturne = STORY_THEMES.find(t => t.name === 'nocturne')!;
    expect(css).toContain(`--primary: ${nocturne.cssVars['--primary']}`);
    // Self-contained themes: one canonical palette, no `.dark`-scoped re-skin.
    expect(css).not.toContain(`.dark [data-theme="nocturne"]`);
  });

  it('theme blocks come AFTER the neutral :root defaults (document order beats equal specificity)', async () => {
    const css = (await compileStoryCss('<p className="p-2">x</p>', { force: true }))!;
    expect(css.indexOf('[data-theme="modernist"]')).toBeGreaterThan(css.indexOf(':root'));
  });

  it('legacy (non-jsx) compiles carry NO theme blocks (byte-stable legacy pipeline)', async () => {
    const css = (await compileStoryCss('<div data-design="tw" class="p-2">x</div>'))!;
    expect(css).not.toContain('[data-theme=');
  });
});
