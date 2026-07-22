/**
 * Join-column inference for the semantic-model editor: picking a reference
 * source (or an m2m bridge) should propose the join columns by name, so the
 * author only ever corrects a mapping instead of assembling one from scratch.
 * Pure name heuristics — no schema profiling, no FK metadata.
 */
import { describe, it, expect } from 'vitest';
import { inferToOneOn, inferM2MThrough, inferPrimaryKey, singularize } from '../infer-join';

const cols = (...names: string[]) => names.map((name) => ({ name, type: 'INTEGER' }));

describe('singularize', () => {
  it('strips plural suffixes conservatively', () => {
    expect(singularize('products')).toBe('product');
    expect(singularize('categories')).toBe('category');
    expect(singularize('statuses')).toBe('status');
    expect(singularize('orders')).toBe('order');
    expect(singularize('order')).toBe('order');
  });
});

describe('inferToOneOn', () => {
  it('classic FK: primary <ref-singular>_id → ref id', () => {
    expect(inferToOneOn(
      cols('id', 'customer_id', 'amount'),
      cols('id', 'name'),
      'customers',
    )).toEqual([{ primaryColumn: 'customer_id', referencedColumn: 'id' }]);
  });

  it('exact shared *_id name when the ref has no bare id', () => {
    expect(inferToOneOn(
      cols('order_id', 'product_id'),
      cols('product_id', 'label'),
      'products',
    )).toEqual([{ primaryColumn: 'product_id', referencedColumn: 'product_id' }]);
  });

  it('returns null when nothing matches by name', () => {
    expect(inferToOneOn(cols('a', 'b'), cols('x', 'y'), 'things')).toBeNull();
  });
});

describe('inferM2MThrough', () => {
  it('orders ↔ products via order_items: pk id ↔ bridge order_id, bridge product_id ↔ ref id', () => {
    expect(inferM2MThrough({
      primaryKey: ['id'],
      primaryColumns: cols('id', 'amount'),
      bridgeColumns: cols('order_id', 'product_id', 'qty'),
      refColumns: cols('id', 'name'),
      primaryTable: 'orders',
      refTable: 'products',
    })).toEqual({
      primaryOn: [{ primaryColumn: 'id', bridgeColumn: 'order_id' }],
      referencedOn: [{ bridgeColumn: 'product_id', referencedColumn: 'id' }],
    });
  });

  it('exact-name pk columns map straight across (composite too)', () => {
    expect(inferM2MThrough({
      primaryKey: ['order_id', 'region'],
      primaryColumns: cols('order_id', 'region'),
      bridgeColumns: cols('order_id', 'region', 'tag_id'),
      refColumns: cols('id', 'name'),
      primaryTable: 'orders',
      refTable: 'tags',
    })).toEqual({
      primaryOn: [
        { primaryColumn: 'order_id', bridgeColumn: 'order_id' },
        { primaryColumn: 'region', bridgeColumn: 'region' },
      ],
      referencedOn: [{ bridgeColumn: 'tag_id', referencedColumn: 'id' }],
    });
  });

  it('returns null when a pk column cannot be mapped onto the bridge', () => {
    expect(inferM2MThrough({
      primaryKey: ['id'],
      primaryColumns: cols('id'),
      bridgeColumns: cols('foo', 'bar'),
      refColumns: cols('id'),
      primaryTable: 'orders',
      refTable: 'tags',
    })).toBeNull();
  });
});

describe('inferPrimaryKey', () => {
  it('prefers a bare id column', () => {
    expect(inferPrimaryKey(cols('id', 'name'), 'orders')).toEqual(['id']);
  });
  it('falls back to <singular>_id', () => {
    expect(inferPrimaryKey(cols('order_id', 'total'), 'orders')).toEqual(['order_id']);
  });
  it('returns null when neither exists', () => {
    expect(inferPrimaryKey(cols('a', 'b'), 'orders')).toBeNull();
  });
});
