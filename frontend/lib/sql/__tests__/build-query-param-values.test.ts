import { describe, it, expect } from 'vitest';
import { buildQueryParamValues } from '@/lib/sql/sql-params';
import type { QuestionParameter } from '@/lib/validation/atlas-schemas';

const P = (name: string, type: 'text' | 'number' | 'date'): QuestionParameter =>
  ({ name, type } as QuestionParameter);

describe('buildQueryParamValues — numeric coercion', () => {
  // Param controls emit strings; a "12" bound to `$1 * INTERVAL '1 week'` makes
  // DuckDB throw "Could not choose a best candidate function *(STRING_LITERAL,
  // INTERVAL)". Declared number params must bind as numbers.
  it('coerces numeric strings to numbers for number-typed params', () => {
    expect(buildQueryParamValues([P('weeks', 'number')], {}, { weeks: '12' })).toEqual({ weeks: 12 });
    expect(buildQueryParamValues([P('rate', 'number')], { rate: '2.5' }, undefined)).toEqual({ rate: 2.5 });
  });

  it('leaves real numbers, text params, and unparseable strings alone', () => {
    expect(buildQueryParamValues([P('weeks', 'number')], {}, { weeks: 12 })).toEqual({ weeks: 12 });
    expect(buildQueryParamValues([P('city', 'text')], {}, { city: '12' })).toEqual({ city: '12' });
    expect(buildQueryParamValues([P('weeks', 'number')], {}, { weeks: 'abc' })).toEqual({ weeks: 'abc' });
  });

  it('still maps empty/missing numerics to null', () => {
    expect(buildQueryParamValues([P('weeks', 'number')], {}, { weeks: '' })).toEqual({ weeks: null });
    expect(buildQueryParamValues([P('weeks', 'number')], {}, {})).toEqual({ weeks: null });
  });
});
