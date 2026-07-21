/**
 * applyContextContentChange — the working-field → version fold used by the
 * context container. Version-scoped fields (docs/metrics/annotations/
 * relationships/views/semanticModels) must land INSIDE the selected version —
 * a top-level write would bypass the save gates (the bug browser-verification
 * caught for semanticModels) and be invisible to the loader/inheritance.
 */
import { describe, it, expect } from 'vitest';
import { applyContextContentChange } from '../version-edit';
import type { ContextContent, ContextVersion, SemanticModelV2 } from '@/lib/types';

const version = (v: number): ContextVersion => ({
  version: v, whitelist: '*', docs: [], createdAt: '2026-01-01', createdBy: 1,
});

const content = (): ContextContent => ({
  versions: [version(1), version(2)],
  published: { all: 1 },
} as ContextContent);

const MODEL: SemanticModelV2 = {
  name: 'Orders', connection: 'wh',
  primary: { kind: 'table', table: 'orders' },
  dimensions: [], measures: [{ name: 'Rows', agg: 'COUNT' }],
};

describe('applyContextContentChange', () => {
  it('folds semanticModels INTO the selected version, never the content root', () => {
    const next = applyContextContentChange(content(), 2, { semanticModels: [MODEL] }, 1);
    expect(next.versions![1].semanticModels).toEqual([MODEL]);
    expect(next.versions![0].semanticModels).toBeUndefined();
    expect((next as Record<string, unknown>).semanticModels).toBeUndefined();
  });

  it('folds the other version-scoped fields the same way', () => {
    const next = applyContextContentChange(content(), 1, { docs: [{ content: 'x' }], views: [] }, 7);
    expect(next.versions![0].docs).toEqual([{ content: 'x' }]);
    expect(next.versions![0].lastEditedBy).toBe(7);
  });

  it('passes non-version fields through at the content level', () => {
    const next = applyContextContentChange(content(), 1, { skills: [] }, 1);
    expect((next as Record<string, unknown>).skills).toEqual([]);
    expect(next.versions![0]).not.toHaveProperty('skills');
  });
});
