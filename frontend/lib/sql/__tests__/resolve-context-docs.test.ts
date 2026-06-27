import { describe, it, expect } from 'vitest';
import { resolveContextDocs, formatContextDocsSection, loadContextDocsByKeys, INLINE_ALL_DOCS_THRESHOLD } from '../schema-filter';
import type { ContextContent, ContextVersion, DocEntry, ResolvedContextDocs } from '@/lib/types';

/** Minimal context with one published version carrying the given docs. */
function makeContext(docs: (DocEntry | string)[], overrides: Partial<ContextVersion> = {}): ContextContent {
  return {
    published: { all: 1 },
    versions: [
      {
        version: 1,
        whitelist: '*',
        docs,
        createdAt: '2026-01-01',
        createdBy: 1,
        ...overrides,
      },
    ],
  } as ContextContent;
}

describe('resolveContextDocs', () => {
  // Helpers to read the two partitions out of the one docs list.
  const lazy = (r: ReturnType<typeof resolveContextDocs>) => r.docs.filter((d) => !d.alwaysInclude);
  const pinned = (r: ReturnType<typeof resolveContextDocs>) => r.docs.filter((d) => d.alwaysInclude);

  it('keeps lazy docs out of the inline set — they carry key + title + description + body', () => {
    const ctx = makeContext([
      { title: 'Revenue Glossary', description: 'How revenue terms map to columns', content: 'SECRET BODY revenue = sum(amount)' },
    ]);
    const r = resolveContextDocs(ctx, 1);

    // Nothing is pinned inline; the doc is a lazy entry carrying its full body.
    expect(pinned(r)).toHaveLength(0);
    expect(lazy(r)).toHaveLength(1);
    expect(lazy(r)[0]).toMatchObject({
      key: 'revenue_glossary',
      title: 'Revenue Glossary',
      description: 'How revenue terms map to columns',
      alwaysInclude: false,
    });
    expect(lazy(r)[0].content).toContain('SECRET BODY');
  });

  it('marks alwaysInclude docs pinned and the rest lazy, in one list', () => {
    const ctx = makeContext([
      { title: 'Pinned Rules', description: 'Always-on rules', content: 'INLINE BODY pinned', alwaysInclude: true },
      { title: 'Lazy Doc', description: 'Loaded on demand', content: 'LAZY BODY' },
    ]);
    const r = resolveContextDocs(ctx, 1);

    expect(pinned(r).map((d) => d.content)).toContain('INLINE BODY pinned');
    expect(lazy(r).map((d) => d.key)).toEqual(['lazy_doc']);
    expect(lazy(r).map((d) => d.title)).toEqual(['Lazy Doc']);
  });

  it('derives title/description from the body for legacy docs missing them (and keeps them lazy)', () => {
    const ctx = makeContext([
      { content: '# Revenue Notes\nRevenue is recognized on delivery.\nRefunds net out.\nMORE BODY' },
    ]);
    const r = resolveContextDocs(ctx, 1);

    // Derived title (heading marker stripped) + description (next 2 lines).
    expect(lazy(r)).toHaveLength(1);
    expect(lazy(r)[0].key).toBe('revenue_notes');
    expect(lazy(r)[0].title).toBe('Revenue Notes');
    expect(lazy(r)[0].description).toBe('Revenue is recognized on delivery. Refunds net out.');
    expect(lazy(r)[0].content).toContain('MORE BODY');
  });

  it('pins bare string docs (they carry no title to key off)', () => {
    const r = resolveContextDocs(makeContext(['plain string doc body']), 1);
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0]).toMatchObject({ alwaysInclude: true, title: '', content: 'plain string doc body' });
    expect(lazy(r)).toHaveLength(0);
  });

  it('carries Schema Notes (annotations + metrics) separately', () => {
    const ctx = makeContext([{ title: 'Lazy', description: 'd', content: 'LAZY' }], {
      annotations: [{ schema: 'public', table: 'orders', description: 'Customer orders' }],
      metrics: [{ name: 'Monthly Revenue', schema: 'public', table: 'orders' }],
    });
    const { schemaNotes } = resolveContextDocs(ctx, 1);
    expect(schemaNotes).toContain('## Schema Notes');
    expect(schemaNotes).toContain('- public.orders — Customer orders');
    expect(schemaNotes).toContain('- Monthly Revenue [public.orders]');
  });

  it('de-dupes colliding titles into unique keys', () => {
    const ctx = makeContext([
      { title: 'Glossary', description: 'first', content: 'A' },
      { title: 'Glossary', description: 'second', content: 'B' },
    ]);
    const keys = lazy(resolveContextDocs(ctx, 1)).map((d) => d.key);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toEqual(['glossary', 'glossary_2']);
  });

  it('excludes draft docs entirely', () => {
    const ctx = makeContext([
      { title: 'Draft Doc', description: 'wip', content: 'DRAFT BODY', draft: true },
      { title: 'Live Doc', description: 'ok', content: 'LIVE BODY' },
    ]);
    const r = resolveContextDocs(ctx, 1);
    expect(r.docs.find((d) => d.content.includes('DRAFT BODY'))).toBeUndefined();
    expect(lazy(r).map((d) => d.key)).toEqual(['live_doc']);
  });

  it('produces no lazy docs when every doc is alwaysInclude', () => {
    const ctx = makeContext([{ content: 'just inline', alwaysInclude: true, title: 'x' }]);
    expect(lazy(resolveContextDocs(ctx, 1))).toHaveLength(0);
  });

  it('leaves the inline/lazy decision to the formatter — never promotes here', () => {
    // resolveContextDocs is pure structure: a single plain doc stays lazy; the
    // "inline everything when small" rule lives in formatContextDocsSection.
    const r = resolveContextDocs(makeContext([{ title: 'Doc A', description: 'a', content: 'BODY A' }]), 1);
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0].alwaysInclude).toBe(false);
  });
});

describe('resolveContextDocs — version override', () => {
  // Two published-vs-draft versions; the published one is v1.
  function makeVersionedContext(): ContextContent {
    return {
      published: { all: 1 },
      versions: [
        {
          version: 1,
          whitelist: '*',
          docs: [{ title: 'V1 Doc', description: 'published', content: 'V1 BODY' }],
          createdAt: '2026-01-01',
          createdBy: 1,
        },
        {
          version: 2,
          whitelist: '*',
          docs: [{ title: 'V2 Doc', description: 'draft', content: 'V2 BODY' }],
          createdAt: '2026-01-02',
          createdBy: 1,
        },
      ],
    } as ContextContent;
  }

  it('resolves the published version by default', () => {
    const { docs } = resolveContextDocs(makeVersionedContext(), 1);
    expect(docs.map((d) => d.title)).toEqual(['V1 Doc']);
  });

  it('resolves a specific version when one is requested', () => {
    const { docs } = resolveContextDocs(makeVersionedContext(), 1, 2);
    expect(docs.map((d) => d.key)).toEqual(['v2_doc']);
    expect(docs.map((d) => d.title)).toEqual(['V2 Doc']);
  });

  it('falls back to published when the requested version does not exist', () => {
    const { docs } = resolveContextDocs(makeVersionedContext(), 1, 99);
    expect(docs.map((d) => d.title)).toEqual(['V1 Doc']);
  });
});

// The shared formatter is the single source of truth for the "## Context" body
// layout — the agent prompt and the docs sidebar both render its output, so these
// pin the headers/omission rules both depend on.
// Assert on stable pieces (section headers, doc bodies, keys, fallbacks) rather
// than exact strings — the precise header/line wording is tuned independently.
describe('formatContextDocsSection', () => {
  const inlineDoc = { key: '', title: '', content: 'INLINE DOCS', alwaysInclude: true };
  // N would-be-lazy docs — enough of them (>= threshold) keeps them lazy so the
  // catalog actually renders. Below the threshold the formatter inlines them all.
  const lazyDocs = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      key: `foo_${i}`,
      title: `Foo ${i}`,
      description: `about foo ${i}`,
      content: `FOO BODY ${i}`,
      alwaysInclude: false,
    }));

  it('renders both sections, inlining pinned docs and advertising lazy docs by key', () => {
    // 1 pinned + 5 lazy = 6 total (>= threshold) so the lazy docs stay in the catalog.
    const out = formatContextDocsSection({ docs: [inlineDoc, ...lazyDocs(5)] });
    expect(out).toContain('Default Context Docs');
    expect(out).toContain('INLINE DOCS');
    expect(out).toContain('Context Library');
    expect(out).toContain('foo_0');          // lazy doc advertised by key
    expect(out).not.toContain('FOO BODY 0'); // ...but its body is withheld
  });

  it('includes a description in the catalog line when present', () => {
    const out = formatContextDocsSection({ docs: lazyDocs(5) });
    expect(out).toContain('about foo 0');
  });

  it('renders an alwaysInclude doc body inline', () => {
    const out = formatContextDocsSection({ docs: [{ key: '', title: 'Pinned', description: 'd', content: 'PINNED BODY', alwaysInclude: true }] });
    expect(out).toContain('Default Context Docs');
    expect(out).toContain('Pinned');
    expect(out).toContain('PINNED BODY');
  });

  it('puts schema notes under Default Context Docs (separate concern, no doc)', () => {
    const out = formatContextDocsSection({ docs: [], schemaNotes: '## Schema Notes\n- public.orders' });
    expect(out).toContain('Default Context Docs');
    expect(out).toContain('## Schema Notes');
  });

  it('omits the Default section when there are no inline docs or schema notes', () => {
    // All lazy and above the threshold → nothing inlined.
    const out = formatContextDocsSection({ docs: lazyDocs(5) });
    expect(out).not.toContain('Default Context Docs');
    expect(out).toContain('Context Library');
  });

  it('inlines lazy docs only below INLINE_ALL_DOCS_THRESHOLD; at/above it they stay in the catalog', () => {
    // Below the threshold (if there is a positive count below it): docs are inlined
    // and the catalog shows the fixed "nothing to load" line.
    const below = INLINE_ALL_DOCS_THRESHOLD - 1;
    if (below >= 1) {
      const out = formatContextDocsSection({ docs: lazyDocs(below) });
      expect(out).toContain('Default Context Docs');
      expect(out).toContain('FOO BODY 0'); // body inlined, not just advertised
      expect(out).toContain('No additional context documents are available.');
    }
    // At the threshold the lazy docs are advertised by key, not inlined.
    const at = formatContextDocsSection({ docs: lazyDocs(INLINE_ALL_DOCS_THRESHOLD) });
    expect(at).toContain('Context Library');
    expect(at).toContain('foo_0');
    expect(at).not.toContain('FOO BODY 0');
  });

  it('always shows a Context Library line (fixed fallback) when there are no lazy docs', () => {
    const out = formatContextDocsSection({ docs: [inlineDoc] });
    expect(out).toContain('Default Context Docs');
    expect(out).toContain('Context Library');
    expect(out).toContain('No additional context documents are available.');
  });

  it('renders just the fixed "nothing to load" Context Library line when there are no docs', () => {
    // No Default section (no inline docs / schema notes), but the agent still gets
    // an explicit Context Library line so it knows there is nothing to load.
    const out = formatContextDocsSection({});
    expect(out).not.toContain('Default Context Docs');
    expect(out).toContain('Context Library');
    expect(out).toContain('No additional context documents are available.');
  });
});

// Shared resolver behind the LoadContext tool (web/slack agents) AND the MCP
// LoadContext tool — one place for key/title resolution + the over-fetch nudge.
describe('loadContextDocsByKeys', () => {
  const library: ResolvedContextDocs = {
    docs: [
      { key: 'glossary', title: 'Glossary', description: 'terms', content: 'GLOSSARY BODY', alwaysInclude: false },
      { key: 'cohorts', title: 'Cohorts', description: 'cohort logic', content: 'COHORTS BODY', alwaysInclude: false },
      { key: 'billing', title: 'Billing', description: 'billing rules', content: 'BILLING BODY', alwaysInclude: false },
      { key: 'pricing', title: 'Pricing', description: 'price book', content: 'PRICING BODY', alwaysInclude: false },
      { key: 'refunds', title: 'Refunds', description: 'refund policy', content: 'REFUNDS BODY', alwaysInclude: false },
      // alwaysInclude docs are NOT loadable — they are already inline.
      { key: '', title: 'Pinned', content: 'PINNED BODY', alwaysInclude: true },
    ],
  };

  it('resolves requested docs by key', () => {
    const { payload, isError } = loadContextDocsByKeys(library, ['glossary']);
    expect(isError).toBe(false);
    expect(payload.success).toBe(true);
    expect(payload.docs).toEqual([{ key: 'glossary', title: 'Glossary', content: 'GLOSSARY BODY' }]);
    expect(payload.missing).toBeUndefined();
    expect(payload.warning).toBeUndefined();
  });

  it('falls back to a unique human title when the key is actually the title', () => {
    const { payload } = loadContextDocsByKeys(library, ['Glossary']);
    expect(payload.docs).toEqual([{ key: 'glossary', title: 'Glossary', content: 'GLOSSARY BODY' }]);
  });

  it('never loads alwaysInclude (already-inline) docs', () => {
    const { payload } = loadContextDocsByKeys(library, ['Pinned']);
    expect(payload.docs).toEqual([]);
    expect(payload.missing).toEqual(['Pinned']);
  });

  it('reports unknown keys in `missing` without failing', () => {
    const { payload, isError } = loadContextDocsByKeys(library, ['glossary', 'Nope']);
    expect(isError).toBe(false);
    expect(payload.success).toBe(true);
    expect(payload.missing).toEqual(['Nope']);
  });

  it('errors (without resolving) when keys is empty', () => {
    const { payload, isError } = loadContextDocsByKeys(library, []);
    expect(isError).toBe(true);
    expect(payload.success).toBe(false);
    expect(payload.error).toBeTruthy();
  });

  it('errors when there is no loadable library', () => {
    const { payload, isError } = loadContextDocsByKeys({ docs: [{ key: '', title: 'x', content: 'inline', alwaysInclude: true }] }, ['glossary']);
    expect(isError).toBe(true);
    expect(payload.success).toBe(false);
  });

  it('errors when the context is undefined', () => {
    const { isError } = loadContextDocsByKeys(undefined, ['glossary']);
    expect(isError).toBe(true);
  });

  it('warns at the absolute over-fetch threshold (5)', () => {
    const { payload } = loadContextDocsByKeys(library, ['glossary', 'cohorts', 'billing', 'pricing', 'refunds']);
    expect(payload.docs).toHaveLength(5);
    expect(typeof payload.warning).toBe('string');
  });

  it('does not warn below the threshold', () => {
    const { payload } = loadContextDocsByKeys(library, ['glossary', 'cohorts', 'billing']);
    expect(payload.docs).toHaveLength(3);
    expect(payload.warning).toBeUndefined();
  });

  it('de-dupes repeated keys', () => {
    const { payload } = loadContextDocsByKeys(library, ['glossary', 'glossary']);
    expect(payload.docs).toHaveLength(1);
  });
});
