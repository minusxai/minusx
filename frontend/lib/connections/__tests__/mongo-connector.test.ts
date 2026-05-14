// MongoConnector — pure helpers. The MongoDB I/O paths are not unit-tested
// here (would need a real Mongo). These tests cover URI construction and
// the BSON-document → SQL-shape projection used by query() + getSchema().

import { describe, it, expect } from 'vitest';
import {
  buildMongoUri,
  inferSqlType,
  documentsToQueryResultColumns,
  enforceMongoLimit,
} from '@/lib/connections/mongo-connector';

describe('buildMongoUri', () => {
  it('builds an unauthenticated URI from host + port', () => {
    expect(buildMongoUri({ host: 'localhost', port: 27017, database: 'foo' }))
      .toBe('mongodb://localhost:27017');
  });

  it('encodes username + password when present', () => {
    expect(buildMongoUri({ host: 'h', port: 27017, database: 'd', username: 'u@x', password: 'p&s' }))
      .toBe('mongodb://u%40x:p%26s@h:27017');
  });

  it('omits password segment when only username is set', () => {
    expect(buildMongoUri({ host: 'h', port: 27017, database: 'd', username: 'u' }))
      .toBe('mongodb://u:@h:27017');
  });
});

describe('inferSqlType', () => {
  it('maps JS string to TEXT', () => {
    expect(inferSqlType('hi')).toBe('TEXT');
  });
  it('maps integer JS number to INTEGER', () => {
    expect(inferSqlType(42)).toBe('INTEGER');
  });
  it('maps fractional JS number to REAL', () => {
    expect(inferSqlType(3.14)).toBe('REAL');
  });
  it('maps boolean to BOOLEAN', () => {
    expect(inferSqlType(true)).toBe('BOOLEAN');
  });
  it('maps Date to TIMESTAMP', () => {
    expect(inferSqlType(new Date())).toBe('TIMESTAMP');
  });
  it('maps array to ARRAY', () => {
    expect(inferSqlType([1, 2])).toBe('ARRAY');
  });
  it('maps plain object to OBJECT', () => {
    expect(inferSqlType({ a: 1 })).toBe('OBJECT');
  });
  it('maps null/undefined to UNKNOWN (caller picks first non-null)', () => {
    expect(inferSqlType(null)).toBe('UNKNOWN');
    expect(inferSqlType(undefined)).toBe('UNKNOWN');
  });
});

describe('documentsToQueryResultColumns', () => {
  // A native aggregation pipeline returns BSON documents (each may have
  // arbitrary keys). We flatten to {columns, types, rows} by taking the union
  // of keys across all rows and inferring types from the first non-null value.

  it('returns empty columns/types when no rows', () => {
    expect(documentsToQueryResultColumns([])).toEqual({ columns: [], types: [] });
  });

  it('takes union of keys across rows', () => {
    const docs = [{ a: 1 }, { b: 'x' }, { a: 2, c: true }];
    const { columns } = documentsToQueryResultColumns(docs);
    expect(columns.sort()).toEqual(['a', 'b', 'c']);
  });

  it('infers types from the first non-null value seen per column', () => {
    const docs = [{ a: null }, { a: 1 }, { a: 'x' }];
    const { columns, types } = documentsToQueryResultColumns(docs);
    const typeFor = (col: string) => types[columns.indexOf(col)];
    expect(typeFor('a')).toBe('INTEGER');
  });

  it('falls back to UNKNOWN when a column is null in every row', () => {
    const docs = [{ a: null }, { a: null }];
    const { columns, types } = documentsToQueryResultColumns(docs);
    expect(types[columns.indexOf('a')]).toBe('UNKNOWN');
  });
});

describe('enforceMongoLimit', () => {
  // Mirrors the SQL `enforceQueryLimit` behaviour for aggregation pipelines:
  // default cap of 1000 rows, hard ceiling of 10000, applied at the END of
  // the pipeline. A terminal `$limit` is the row cap; an early `$limit` is a
  // deliberate sub-step and is left untouched.

  it('appends {$limit: 1000} to an empty pipeline', () => {
    expect(enforceMongoLimit([])).toEqual([{ $limit: 1000 }]);
  });

  it('appends {$limit: 1000} when the pipeline has no terminal $limit', () => {
    const pipe = [{ $match: { country: 'DE' } }];
    expect(enforceMongoLimit(pipe)).toEqual([
      { $match: { country: 'DE' } },
      { $limit: 1000 },
    ]);
  });

  it('clamps a terminal $limit above the 10000 ceiling', () => {
    expect(enforceMongoLimit([{ $match: {} }, { $limit: 50000 }])).toEqual([
      { $match: {} },
      { $limit: 10000 },
    ]);
  });

  it('leaves a terminal $limit at or below the ceiling unchanged', () => {
    expect(enforceMongoLimit([{ $limit: 500 }])).toEqual([{ $limit: 500 }]);
    expect(enforceMongoLimit([{ $limit: 10000 }])).toEqual([{ $limit: 10000 }]);
  });

  it('leaves an early (non-terminal) $limit untouched and still appends the default', () => {
    const pipe = [{ $limit: 5 }, { $match: { x: 1 } }];
    expect(enforceMongoLimit(pipe)).toEqual([
      { $limit: 5 },
      { $match: { x: 1 } },
      { $limit: 1000 },
    ]);
  });

  it('does not mutate the input pipeline', () => {
    const pipe = [{ $match: {} }];
    enforceMongoLimit(pipe);
    expect(pipe).toEqual([{ $match: {} }]);
  });
});
