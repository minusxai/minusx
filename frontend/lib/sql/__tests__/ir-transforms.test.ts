import { removeNoneParamConditions } from '../ir-transforms';
import { QueryIR, FilterCondition } from '../ir-types';

function makeIR(conditions: Partial<FilterCondition>[]): QueryIR {
  return {
    version: 1,
    select: [{ type: 'column', column: '*' }],
    from: { table: 'orders' },
    where: { operator: 'AND', conditions: conditions as FilterCondition[] },
  };
}

describe('removeNoneParamConditions', () => {
  it('returns IR unchanged when noneParams is empty', () => {
    const ir = makeIR([{ column: 'status', operator: '=', param_name: 'status' }]);
    expect(removeNoneParamConditions(ir, new Set())).toEqual(ir);
  });

  it('removes a single WHERE condition whose param is None', () => {
    const ir = makeIR([{ column: 'status', operator: '=', param_name: 'status' }]);
    const result = removeNoneParamConditions(ir, new Set(['status']));
    expect(result.where).toBeUndefined();
  });

  it('removes one AND-connected condition, keeps the other', () => {
    const ir = makeIR([
      { column: 'status', operator: '=', param_name: 'status' },
      { column: 'region', operator: '=', param_name: 'region' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['status']));
    expect(result.where?.conditions).toHaveLength(1);
    expect((result.where!.conditions[0] as FilterCondition).param_name).toBe('region');
  });

  it('removes filter preceded by AND, keeps the other', () => {
    const ir = makeIR([
      { column: 'region', operator: '=', param_name: 'region' },
      { column: 'status', operator: '=', param_name: 'status' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['status']));
    expect(result.where?.conditions).toHaveLength(1);
    expect((result.where!.conditions[0] as FilterCondition).param_name).toBe('region');
  });

  it('removes all conditions, collapses WHERE entirely', () => {
    const ir = makeIR([
      { column: 'a', operator: '=', param_name: 'p1' },
      { column: 'b', operator: '=', param_name: 'p2' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['p1', 'p2']));
    expect(result.where).toBeUndefined();
  });

  it('removes WHERE entirely and preserves GROUP BY', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'column', column: '*' }],
      from: { table: 't' },
      where: { operator: 'AND', conditions: [{ column: 'col', operator: '=', param_name: 'p' }] },
      group_by: { columns: [{ column: 'id' }] },
    };
    const result = removeNoneParamConditions(ir, new Set(['p']));
    expect(result.where).toBeUndefined();
    expect(result.group_by).toBeDefined();
  });

  it('removes nested FilterGroup when all its conditions become None', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'column', column: '*' }],
      from: { table: 't' },
      where: {
        operator: 'AND',
        conditions: [
          { column: 'a', operator: '=', param_name: 'p1' },
          {
            operator: 'OR',
            conditions: [
              { column: 'b', operator: '=', param_name: 'p2' },
              { column: 'c', operator: '=', param_name: 'p3' },
            ],
          },
        ],
      },
    };
    const result = removeNoneParamConditions(ir, new Set(['p1', 'p2', 'p3']));
    expect(result.where).toBeUndefined();
  });

  it('keeps nested OR group when some of its conditions remain', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'column', column: '*' }],
      from: { table: 't' },
      where: {
        operator: 'AND',
        conditions: [
          {
            operator: 'OR',
            conditions: [
              { column: 'b', operator: '=', param_name: 'p2' },
              { column: 'c', operator: '=', param_name: 'p3' },
            ],
          },
        ],
      },
    };
    const result = removeNoneParamConditions(ir, new Set(['p2']));
    // OR group still has p3
    expect(result.where?.conditions).toHaveLength(1);
    const innerGroup = result.where!.conditions[0] as import('../ir-types').FilterGroup;
    expect(innerGroup.conditions).toHaveLength(1);
    expect((innerGroup.conditions[0] as FilterCondition).param_name).toBe('p3');
  });

  it('does not touch HAVING when only WHERE params are None', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'aggregate', aggregate: 'COUNT', column: '*' }],
      from: { table: 't' },
      where: { operator: 'AND', conditions: [{ column: 'x', operator: '=', param_name: 'p' }] },
      having: { operator: 'AND', conditions: [{ aggregate: 'COUNT', column: null, operator: '>', value: 5 }] },
    };
    const result = removeNoneParamConditions(ir, new Set(['p']));
    expect(result.where).toBeUndefined();
    expect(result.having?.conditions).toHaveLength(1);
  });

  it('removes HAVING condition when its param is None', () => {
    const ir: QueryIR = {
      version: 1,
      select: [{ type: 'aggregate', aggregate: 'COUNT', column: '*' }],
      from: { table: 't' },
      having: {
        operator: 'AND',
        conditions: [{ aggregate: 'COUNT', column: null, operator: '>', param_name: 'min_count' }],
      },
    };
    const result = removeNoneParamConditions(ir, new Set(['min_count']));
    expect(result.having).toBeUndefined();
  });

  it('keeps conditions with literal values when other params are None', () => {
    const ir = makeIR([
      { column: 'active', operator: '=', value: true },
      { column: 'region', operator: '=', param_name: 'region' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['region']));
    expect(result.where?.conditions).toHaveLength(1);
    expect((result.where!.conditions[0] as FilterCondition).value).toBe(true);
  });

  it('removes a WHERE ILIKE condition whose param is None', () => {
    const ir = makeIR([{ column: 'name', operator: 'ILIKE', param_name: 'search' }]);
    const result = removeNoneParamConditions(ir, new Set(['search']));
    expect(result.where).toBeUndefined();
  });

  it('handles mix of None and valued params', () => {
    const ir = makeIR([
      { column: 'a', operator: '=', param_name: 'p1' },
      { column: 'b', operator: '=', param_name: 'p2' },
      { column: 'c', operator: '=', param_name: 'p3' },
    ]);
    const result = removeNoneParamConditions(ir, new Set(['p1', 'p3']));
    expect(result.where?.conditions).toHaveLength(1);
    expect((result.where!.conditions[0] as FilterCondition).param_name).toBe('p2');
  });
});
