/**
 * Semantic model resolution tests — published-version + inherited merge
 * semantics (own model wins on name collision) and connection scoping.
 */
import { describe, it, expect } from 'vitest';
import { resolveSemanticModels, semanticModelsForConnection } from '../resolve';
import type { ContextContent, SemanticModel } from '@/lib/types';

const model = (name: string, connection = 'warehouse', table = 'orders'): SemanticModel => ({
  name, connection, table, dimensions: [], measures: [{ name: 'Count', agg: 'COUNT' }],
});

const content = (overrides: Partial<ContextContent> = {}): ContextContent => ({
  versions: [
    { version: 1, whitelist: '*', docs: [], createdAt: '', createdBy: 1, semanticModels: [model('Orders')] },
    { version: 2, whitelist: '*', docs: [], createdAt: '', createdBy: 1, semanticModels: [model('Orders v2'), model('Users', 'warehouse', 'users')] },
  ],
  published: { all: 1 },
  ...overrides,
} as ContextContent);

describe('resolveSemanticModels', () => {
  it('uses the published version by default and an explicit version when given', () => {
    expect(resolveSemanticModels(content(), 1).map((m) => m.name)).toEqual(['Orders']);
    expect(resolveSemanticModels(content(), 1, 2).map((m) => m.name)).toEqual(['Orders v2', 'Users']);
  });

  it('merges inherited models, own version winning on name collision', () => {
    const c = content({
      fullSemanticModels: [model('Inherited'), { ...model('Orders'), table: 'parent_orders' }],
    });
    const resolved = resolveSemanticModels(c, 1);
    expect(resolved.map((m) => m.name).sort()).toEqual(['Inherited', 'Orders']);
    expect(resolved.find((m) => m.name === 'Orders')?.table).toBe('orders');
  });

  it('returns [] for contexts without semantic config (backward compatible)', () => {
    const c = { versions: [{ version: 1, whitelist: '*', docs: [], createdAt: '', createdBy: 1 }], published: { all: 1 } } as unknown as ContextContent;
    expect(resolveSemanticModels(c, 1)).toEqual([]);
  });
});

describe('semanticModelsForConnection', () => {
  it('scopes models to the connection and handles missing connection', () => {
    const models = [model('A', 'warehouse'), model('B', 'other')];
    expect(semanticModelsForConnection(models, 'warehouse').map((m) => m.name)).toEqual(['A']);
    expect(semanticModelsForConnection(models, undefined)).toEqual([]);
  });
});
