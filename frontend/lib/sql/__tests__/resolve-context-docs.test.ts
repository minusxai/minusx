import { describe, it, expect } from 'vitest';
import { resolveContextDocs } from '../schema-filter';
import type { ContextContent, ContextVersion, DocEntry } from '@/lib/types';

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
  it('keeps lazy docs out of the inline string — catalog shows key + title + description, never the body', () => {
    const ctx = makeContext([
      { title: 'Revenue Glossary', description: 'How revenue terms map to columns', content: 'SECRET BODY revenue = sum(amount)' },
    ]);
    const { inline, catalog, library } = resolveContextDocs(ctx, 1);

    // Catalog advertises the doc by key + title + description, but not its body.
    expect(catalog).toContain('"revenue_glossary"');           // the key (slug) to pass
    expect(catalog).toContain('Revenue Glossary');             // the human title
    expect(catalog).toContain('How revenue terms map to columns');
    expect(catalog).not.toContain('SECRET BODY');

    // The body is not inlined into the prompt string.
    expect(inline).not.toContain('SECRET BODY');

    // The library separates key (slug) from title, and carries the full content.
    expect(library).toHaveLength(1);
    expect(library[0].key).toBe('revenue_glossary');
    expect(library[0].title).toBe('Revenue Glossary');
    expect(library[0].content).toContain('SECRET BODY');
  });

  it('inlines alwaysInclude docs and excludes them from catalog/library', () => {
    const ctx = makeContext([
      { title: 'Pinned Rules', description: 'Always-on rules', content: 'INLINE BODY pinned', alwaysInclude: true },
      { title: 'Lazy Doc', description: 'Loaded on demand', content: 'LAZY BODY' },
    ]);
    const { inline, catalog, library } = resolveContextDocs(ctx, 1);

    expect(inline).toContain('INLINE BODY pinned');
    expect(inline).not.toContain('LAZY BODY');

    expect(catalog).toContain('Lazy Doc');
    expect(catalog).not.toContain('Pinned Rules');

    expect(library.map((d) => d.key)).toEqual(['lazy_doc']);
    expect(library.map((d) => d.title)).toEqual(['Lazy Doc']);
  });

  it('derives title/description from the body for legacy docs missing them (and keeps them lazy)', () => {
    const ctx = makeContext([
      { content: '# Revenue Notes\nRevenue is recognized on delivery.\nRefunds net out.\nMORE BODY' },
    ]);
    const { inline, catalog, library } = resolveContextDocs(ctx, 1);

    // Derived title (heading marker stripped) + description (next 2 lines).
    expect(library).toHaveLength(1);
    expect(library[0].key).toBe('revenue_notes');
    expect(library[0].title).toBe('Revenue Notes');
    expect(library[0].description).toBe('Revenue is recognized on delivery. Refunds net out.');
    expect(catalog).toContain('Revenue Notes');
    // Body is lazy, not inlined.
    expect(inline).not.toContain('MORE BODY');
    expect(library[0].content).toContain('MORE BODY');
  });

  it('pins bare string docs inline (they carry no title to key off)', () => {
    const ctx = makeContext(['plain string doc body']);
    const { inline, catalog, library } = resolveContextDocs(ctx, 1);
    expect(inline).toContain('plain string doc body');
    expect(catalog).toBe('');
    expect(library).toHaveLength(0);
  });

  it('keeps Schema Notes (annotations + metrics) inline', () => {
    const ctx = makeContext([{ title: 'Lazy', description: 'd', content: 'LAZY' }], {
      annotations: [{ schema: 'public', table: 'orders', description: 'Customer orders' }],
      metrics: [{ name: 'Monthly Revenue', schema: 'public', table: 'orders' }],
    });
    const { inline } = resolveContextDocs(ctx, 1);
    expect(inline).toContain('## Schema Notes');
    expect(inline).toContain('- public.orders — Customer orders');
    expect(inline).toContain('- Monthly Revenue [public.orders]');
  });

  it('de-dupes colliding titles into unique keys', () => {
    const ctx = makeContext([
      { title: 'Glossary', description: 'first', content: 'A' },
      { title: 'Glossary', description: 'second', content: 'B' },
    ]);
    const { library } = resolveContextDocs(ctx, 1);
    const keys = library.map((d) => d.key);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toBe('glossary');
    expect(keys[1]).toBe('glossary_2');
    // Both keep the same human title.
    expect(library.map((d) => d.title)).toEqual(['Glossary', 'Glossary']);
  });

  it('excludes draft docs entirely', () => {
    const ctx = makeContext([
      { title: 'Draft Doc', description: 'wip', content: 'DRAFT BODY', draft: true },
      { title: 'Live Doc', description: 'ok', content: 'LIVE BODY' },
    ]);
    const { inline, catalog, library } = resolveContextDocs(ctx, 1);
    expect(inline).not.toContain('DRAFT BODY');
    expect(catalog).not.toContain('Draft Doc');
    expect(library.map((d) => d.key)).toEqual(['live_doc']);
  });

  it('returns an empty catalog/library when there are no lazy docs', () => {
    const ctx = makeContext([{ content: 'just inline', alwaysInclude: true, title: 'x' }]);
    const { catalog, library } = resolveContextDocs(ctx, 1);
    expect(catalog).toBe('');
    expect(library).toHaveLength(0);
  });
});
