/**
 * Semantic model resolution — models are loader-DERIVED (`fullSemanticModels`);
 * there is no authored per-version model config anymore. Resolution is just
 * "what the loader computed", plus connection scoping for the Semantic tab.
 */
import { describe, it, expect } from 'vitest';
import { resolveSemanticModels, semanticModelsForConnection } from '../resolve';
import type { ContextContent, SemanticModel } from '@/lib/types';

const model = (name: string, connection = 'warehouse', table = 'orders'): SemanticModel => ({
  name, connection, table, dimensions: [], measures: [{ name: 'Count', agg: 'COUNT' }],
});

describe('resolveSemanticModels', () => {
  it('returns the loader-derived models', () => {
    const c = {
      versions: [{ version: 1, whitelist: '*', docs: [], createdAt: '', createdBy: 1 }],
      published: { all: 1 },
      fullSemanticModels: [model('Orders'), model('Users', 'warehouse', 'users')],
    } as unknown as ContextContent;
    expect(resolveSemanticModels(c).map((m) => m.name)).toEqual(['Orders', 'Users']);
  });

  it('returns [] when the loader derived nothing (no columns / no context)', () => {
    const c = {
      versions: [{ version: 1, whitelist: '*', docs: [], createdAt: '', createdBy: 1 }],
      published: { all: 1 },
    } as unknown as ContextContent;
    expect(resolveSemanticModels(c)).toEqual([]);
  });

  it('ignores legacy authored semanticModels on versions', () => {
    const c = {
      versions: [{
        version: 1, whitelist: '*', docs: [], createdAt: '', createdBy: 1,
        semanticModels: [model('Legacy')],
      }],
      published: { all: 1 },
      fullSemanticModels: [model('Derived')],
    } as unknown as ContextContent;
    expect(resolveSemanticModels(c).map((m) => m.name)).toEqual(['Derived']);
  });
});

describe('semanticModelsForConnection', () => {
  it('scopes models to the connection and handles missing connection', () => {
    const models = [model('A', 'warehouse'), model('B', 'other')];
    expect(semanticModelsForConnection(models, 'warehouse').map((m) => m.name)).toEqual(['A']);
    expect(semanticModelsForConnection(models, undefined)).toEqual([]);
  });
});
