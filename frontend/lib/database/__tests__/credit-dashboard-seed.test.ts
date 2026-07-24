import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateFileState } from '@/lib/validation/content-validators';
import { applyNoneParams } from '@/lib/sql/none-params';
import { syncParametersWithSQL } from '@/lib/sql/sql-params';
import type { QuestionContent } from '@/lib/types';

/**
 * TRIPWIRE for the seeded internals "Credit Usage" dashboard (workspace-template
 * ids 56-61) and its query-sourced filter params.
 *
 * These queries drive the filter bar through the None mechanism: every filter
 * defaults to None (removed → all rows), and picking a dropdown value re-adds a
 * `col = :param` condition. That only works if:
 *   1. the content validates against the Atlas schema (params + parameterValues), and
 *   2. `applyNoneParams` on the ACTUAL seeded SQL keeps the mode filter while
 *      dropping every None param condition.
 *
 * (2) is subtle: the IR round-trip `applyNoneParams` does when any param is None
 * is LOSSY for `COALESCE(...) IN (...)` and top-level `OR` groups — it drops
 * them. The seed therefore expresses the mode filter as `COALESCE(mode,'org')
 * <> 'internals'` (round-trip-safe). If someone rewrites it back to `IN (...)`,
 * the default (all-None) dashboard would silently lose its mode scoping and
 * leak internals-mode usage. This test goes RED first.
 */

const CREDIT_QUESTION_IDS = [56, 57, 58, 59, 60];
const CREDIT_FILTER_PARAMS = ['grade', 'provider', 'model', 'user_email', 'role'];

interface TemplateDoc {
  id: number;
  type: string;
  content: unknown;
}

function loadTemplateDocs(): TemplateDoc[] {
  const raw = readFileSync(join(__dirname, '..', 'workspace-template.json'), 'utf8');
  return (JSON.parse(raw).documents as TemplateDoc[]);
}

describe('seeded Credit Usage dashboard', () => {
  const docs = loadTemplateDocs();
  const byId = new Map(docs.map((d) => [d.id, d]));

  it('has all six seed docs (5 questions + 1 dashboard)', () => {
    for (const id of [...CREDIT_QUESTION_IDS, 61]) expect(byId.has(id)).toBe(true);
  });

  it('every credit doc validates against the Atlas schema', () => {
    for (const id of [...CREDIT_QUESTION_IDS, 61]) {
      const doc = byId.get(id)!;
      expect(validateFileState({ type: doc.type as 'question', content: doc.content })).toBeNull();
    }
  });

  it('each question declares all five filter params with dropdown sources + None defaults', () => {
    for (const id of CREDIT_QUESTION_IDS) {
      const c = byId.get(id)!.content as QuestionContent;
      const names = (c.parameters ?? []).map((p) => p.name).sort();
      expect(names).toEqual([...CREDIT_FILTER_PARAMS].sort());
      for (const p of c.parameters ?? []) {
        expect(p.source?.type).toBe('sql'); // query-populated dropdown
        expect((c.parameterValues ?? {})[p.name]).toBeNull(); // default None → all rows
      }
    }
  });

  it('sync against SQL keeps all five params (so the dashboard merges them into filter controls)', () => {
    for (const id of CREDIT_QUESTION_IDS) {
      const c = byId.get(id)!.content as QuestionContent;
      const synced = syncParametersWithSQL(c.query!, c.parameters ?? []);
      expect(synced.map((p) => p.name).sort()).toEqual([...CREDIT_FILTER_PARAMS].sort());
      // Sources must survive the sync — otherwise the dropdowns lose their query population.
      for (const p of synced) expect(p.source?.type).toBe('sql');
    }
  });

  it('all-None keeps the mode filter but drops every param condition (round-trip-safe)', async () => {
    const allNone = Object.fromEntries(CREDIT_FILTER_PARAMS.map((n) => [n, null]));
    for (const id of CREDIT_QUESTION_IDS) {
      const c = byId.get(id)!.content as QuestionContent;
      const { sql } = await applyNoneParams(c.query!, allNone, 'postgres');
      // Mode scoping must survive the IR round-trip.
      expect(sql).toMatch(/internals/);
      // No leftover placeholders — every None condition removed, nothing bound to NULL.
      for (const n of CREDIT_FILTER_PARAMS) expect(sql).not.toContain(`:${n}`);
      // Guard against the lossy form silently reappearing.
      expect(sql).not.toMatch(/IN\s*\(\s*'org'/i);
    }
  });

  it('a set value survives while the rest are dropped', async () => {
    const c = byId.get(58)!.content as QuestionContent; // Credits by Grade
    const { sql, params } = await applyNoneParams(
      c.query!,
      { grade: 'core', provider: null, model: null, user_email: null, role: null },
      'postgres',
    );
    expect(sql).toContain(':grade');
    expect(params).toEqual({ grade: 'core' });
    expect(sql).not.toContain(':model');
  });
});
