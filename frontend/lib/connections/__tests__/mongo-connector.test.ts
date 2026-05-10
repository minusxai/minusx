// MongoConnector — pure helpers. The MongoDB I/O paths are not unit-tested
// here (would need a real Mongo). These tests cover URI construction and
// the BSON-document → SQL-shape projection used by query() + getSchema().

import { describe, it, expect } from 'vitest';
import {
  buildMongoUri,
  inferSqlType,
  documentsToQueryResultColumns,
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
  // QueryLeaf returns BSON documents (each may have arbitrary keys). We
  // flatten to {columns, types, rows} by taking the union of keys across
  // all rows and inferring types from the first non-null value seen.

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
