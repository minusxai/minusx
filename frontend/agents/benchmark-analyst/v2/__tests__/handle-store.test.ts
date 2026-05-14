import {
  storeHandle,
  getHandle,
  hasHandle,
  clearHandles,
  handleCount,
  getAllHandles,
} from '../handle-store';
import type { QueryResult } from '@/lib/connections/base';

const makeResult = (rows: Record<string, unknown>[]): QueryResult => ({
  columns: rows[0] ? Object.keys(rows[0]) : [],
  types: rows[0] ? Object.keys(rows[0]).map(() => 'VARCHAR') : [],
  rows,
  finalQuery: 'SELECT 1',
});

describe('handle-store', () => {
  beforeEach(() => {
    clearHandles();
  });

  it('stores and retrieves a handle', () => {
    const result = makeResult([{ id: 1, name: 'test' }]);
    const handleId = storeHandle(result);

    expect(handleId).toMatch(/^handle_\d+_/);
    expect(hasHandle(handleId)).toBe(true);

    const stored = getHandle(handleId);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(handleId);
    expect(stored!.result).toBe(result);
    expect(stored!.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('generates unique handle IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(storeHandle(makeResult([])));
    }
    expect(ids.size).toBe(100);
  });

  it('returns undefined for unknown handle', () => {
    expect(getHandle('unknown_handle')).toBeUndefined();
    expect(hasHandle('unknown_handle')).toBe(false);
  });

  it('clears all handles', () => {
    storeHandle(makeResult([]));
    storeHandle(makeResult([]));
    expect(handleCount()).toBe(2);

    clearHandles();
    expect(handleCount()).toBe(0);
  });

  it('counts handles correctly', () => {
    expect(handleCount()).toBe(0);
    storeHandle(makeResult([]));
    expect(handleCount()).toBe(1);
    storeHandle(makeResult([]));
    expect(handleCount()).toBe(2);
  });

  it('returns all handles as a map', () => {
    const id1 = storeHandle(makeResult([{ a: 1 }]));
    const id2 = storeHandle(makeResult([{ b: 2 }]));

    const all = getAllHandles();
    expect(all.size).toBe(2);
    expect(all.has(id1)).toBe(true);
    expect(all.has(id2)).toBe(true);
  });

  it('preserves full QueryResult data', () => {
    const result: QueryResult = {
      columns: ['id', 'name', 'value'],
      types: ['INTEGER', 'VARCHAR', 'DECIMAL'],
      rows: [
        { id: 1, name: 'foo', value: 100.5 },
        { id: 2, name: 'bar', value: 200.0 },
      ],
      finalQuery: 'SELECT id, name, value FROM data',
    };

    const handleId = storeHandle(result);
    const stored = getHandle(handleId);

    expect(stored!.result.columns).toEqual(['id', 'name', 'value']);
    expect(stored!.result.types).toEqual(['INTEGER', 'VARCHAR', 'DECIMAL']);
    expect(stored!.result.rows).toHaveLength(2);
    expect(stored!.result.finalQuery).toBe('SELECT id, name, value FROM data');
  });
});
