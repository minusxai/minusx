// What the AGENT sees + may edit on a context file.
//
// shapeContextForAgent: FLATTENS the live (published) version's knowledge layer + the content-level
// evals/skills into a single working view (docs/metrics/annotations/evals/skills), dropping the
// whitelist (human-managed), version bookkeeping (versions[]/published) and the server-computed
// schema cache (fullSchema/parentSchema/full*).
//
// foldContextAgentView: the inverse — folds an edited flat view back into the live version, preserving
// versions[]/published and every other stored field.
//
// contextEditWithinBounds: the EditFile guard on the FULL (folded) content — only the authored fields
// may change; version identity / the published pointer may not.
import { describe, it, expect } from 'vitest';
import { shapeContextForAgent, foldContextAgentView, contextEditWithinBounds } from '@/lib/context/context-agent-view';

const schemaWithCols = [
  { databaseName: 'wh', schemas: [
    { schema: 'sales', tables: [{ table: 'orders', columns: [{ name: 'id' }, { name: 'amount' }] }] },
  ] },
];

const wl1 = [{ name: 'wh', type: 'connection', children: [] }];

// A realistic stored (version-based) context: live version is #2 (published.all), with an older #1.
const ctx = () => ({
  versions: [
    { version: 1, whitelist: [], docs: [{ content: 'old', title: 'Old', description: 'old doc' }], createdAt: 't1', createdBy: 1 },
    { version: 2, whitelist: wl1, docs: [{ content: '# Sales', title: 'Sales', description: 'sales docs' }], metrics: [{ name: 'Revenue' }], createdAt: 't2', createdBy: 1, description: 'v2 notes' },
  ],
  published: { all: 2 },
  skills: [{ name: 'skill1', description: 'd', content: 'c', enabled: true, createdAt: 't', updatedAt: 't', createdBy: 1 }],
  evals: [{ type: 'llm', subject: { type: 'explore' } }],
  fullSchema: schemaWithCols,
  parentSchema: schemaWithCols,
  fullDocs: [{ content: 'inherited', title: 'Inherited' }],
});

describe('shapeContextForAgent — flatten to the live version', () => {
  it('exposes only the flat knowledge view; drops whitelist/versions/published/computed', () => {
    const shaped: any = shapeContextForAgent(ctx());
    expect(Object.keys(shaped).sort()).toEqual(['annotations', 'docs', 'evals', 'metrics', 'skills'].filter(k => k in shaped).sort());
    for (const noise of ['whitelist', 'versions', 'published', 'fullSchema', 'parentSchema', 'fullDocs']) {
      expect(noise in shaped).toBe(false);
    }
  });

  it('flattens the LIVE (published) version, not the first', () => {
    const shaped: any = shapeContextForAgent(ctx());
    expect(shaped.docs[0].title).toBe('Sales');       // from version 2 (published.all)
    expect(shaped.metrics[0].name).toBe('Revenue');
  });

  it('lifts content-level evals + skills to the top level', () => {
    const shaped: any = shapeContextForAgent(ctx());
    expect(shaped.skills[0].name).toBe('skill1');
    expect(shaped.evals).toHaveLength(1);
  });

  it('falls back to the first version when published points at a missing version', () => {
    const c = { ...ctx(), published: { all: 99 } };
    const shaped: any = shapeContextForAgent(c);
    expect(shaped.docs[0].title).toBe('Old');         // version 1 fallback
  });

  it('does not mutate the input', () => {
    const input = ctx();
    shapeContextForAgent(input);
    expect(input.versions).toHaveLength(2);
    expect(input.fullSchema).toBe(schemaWithCols);
  });

  it('is a no-op for non-context content', () => {
    const q = { query: 'SELECT 1', connection_name: '' };
    expect(shapeContextForAgent(q)).toBe(q);
  });
});

describe('foldContextAgentView — fold edits back into the live version', () => {
  it('writes edited docs into the live version, preserving versions[]/published', () => {
    const before = ctx();
    const edited = { ...shapeContextForAgent(before) as any, docs: [{ content: '# Sales v2', title: 'Sales', description: 'sales docs' }] };
    const folded: any = foldContextAgentView(before, edited);
    expect(folded.versions).toHaveLength(2);
    expect(folded.published).toEqual({ all: 2 });
    expect(folded.versions[1].docs[0].content).toBe('# Sales v2'); // live version updated
    expect(folded.versions[0].docs[0].content).toBe('old');        // other version untouched
  });

  it('preserves the (human-managed) whitelist — never in the agent view, never folded', () => {
    const before = ctx();
    // Even an edited view that tries to carry a whitelist key must not change the stored whitelist.
    const folded: any = foldContextAgentView(before, { ...shapeContextForAgent(before) as any, whitelist: '*' });
    expect(folded.versions[1].whitelist).toEqual(wl1); // untouched
  });

  it('round-trips: shape → fold with no edits preserves the live version fields', () => {
    const before = ctx();
    const folded: any = foldContextAgentView(before, shapeContextForAgent(before));
    expect(folded.versions[1].docs).toEqual(before.versions[1].docs);
    expect(folded.versions[1].whitelist).toEqual(wl1);
    expect(folded.skills).toEqual(before.skills);
  });

  it('folds content-level evals + skills back to the content level', () => {
    const before = ctx();
    const edited = { ...shapeContextForAgent(before) as any, evals: [] };
    const folded: any = foldContextAgentView(before, edited);
    expect(folded.evals).toEqual([]);
    expect(folded.versions[1].docs[0].title).toBe('Sales'); // version docs preserved
  });
});

describe('contextEditWithinBounds', () => {
  it('allows the folded result of editing authored knowledge fields', () => {
    const a = ctx();
    const docEdit = foldContextAgentView(a, { ...shapeContextForAgent(a) as any, docs: [{ content: '# new', title: 'Sales', description: 'd' }] });
    expect(contextEditWithinBounds(a, docEdit)).toBe(true);
    const evalEdit = foldContextAgentView(a, { ...shapeContextForAgent(a) as any, evals: [] });
    expect(contextEditWithinBounds(a, evalEdit)).toBe(true);
  });

  it('ignores changes to the server-computed fields (re-derived on load)', () => {
    const a = ctx();
    const b = structuredClone(a); b.fullSchema = []; b.parentSchema = []; b.fullDocs = [];
    expect(contextEditWithinBounds(a, b)).toBe(true);
  });

  it('blocks changing the whitelist, the published pointer, or version identity', () => {
    const a = ctx();
    const wl = structuredClone(a); wl.versions[1].whitelist = [] as any;
    expect(contextEditWithinBounds(a, wl)).toBe(false);
    const pub = structuredClone(a); pub.published = { all: 1 };
    expect(contextEditWithinBounds(a, pub)).toBe(false);
    const ver = structuredClone(a); ver.versions[1].version = 5;
    expect(contextEditWithinBounds(a, ver)).toBe(false);
  });
});
