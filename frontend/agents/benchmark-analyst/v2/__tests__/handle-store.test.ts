// Tests for the handle store: store/fetch, unique IDs, queryable DuckDB tables
import { describe, it, expect, beforeEach } from 'vitest';
import type { QueryResult } from '@/lib/connections/base';
import {
  storeHandle,
  fetchHandle,
  clearHandles,
  getHandleTable,
  queryHandle,
} from '../handle-store';

describe('HandleStore', () => {
  beforeEach(async () => {
    await clearHandles();
  });

  describe('storeHandle / fetchHandle', () => {
    it('stores a query result and returns a unique handle ID', () => {
      const result: QueryResult = {
        columns: ['id', 'name'],
        types: ['INTEGER', 'VARCHAR'],
        rows: [{ id: 1, name: 'Alice' }],
        finalQuery: '',
      };

      const handle = storeHandle(result);

      expect(handle).toMatch(/^handle_/);
      expect(fetchHandle(handle)).toEqual(result);
    });

    it('generates unique handle IDs for each store call', () => {
      const result: QueryResult = {
        columns: ['x'],
        types: ['INT'],
        rows: [{ x: 1 }],
        finalQuery: '',
      };

      const h1 = storeHandle(result);
      const h2 = storeHandle(result);
      const h3 = storeHandle(result);

      expect(h1).not.toBe(h2);
      expect(h2).not.toBe(h3);
      expect(h1).not.toBe(h3);
    });

    it('returns undefined for unknown handle', () => {
      expect(fetchHandle('handle_unknown')).toBeUndefined();
    });

    it('stores result with empty rows', () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [],
        finalQuery: '',
      };

      const handle = storeHandle(result);
      expect(fetchHandle(handle)).toEqual(result);
    });
  });

  describe('clearHandles', () => {
    it('removes all stored handles', async () => {
      const result: QueryResult = {
        columns: ['x'],
        types: ['INT'],
        rows: [{ x: 1 }],
        finalQuery: '',
      };

      const h1 = storeHandle(result);
      const h2 = storeHandle(result);

      expect(fetchHandle(h1)).toBeDefined();
      expect(fetchHandle(h2)).toBeDefined();

      await clearHandles();

      expect(fetchHandle(h1)).toBeUndefined();
      expect(fetchHandle(h2)).toBeUndefined();
    });
  });

  describe('getHandleTable', () => {
    it('returns the DuckDB table name for a handle', () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };

      const handle = storeHandle(result);
      const tableName = getHandleTable(handle);

      expect(tableName).toBe(handle);
    });

    it('returns undefined for unknown handle', () => {
      expect(getHandleTable('handle_unknown')).toBeUndefined();
    });
  });

  describe('queryHandle (DuckDB queryable table)', () => {
    it('allows SQL queries against the stored handle rows', async () => {
      const result: QueryResult = {
        columns: ['id', 'value'],
        types: ['INTEGER', 'DOUBLE'],
        rows: [
          { id: 1, value: 100 },
          { id: 2, value: 200 },
          { id: 3, value: 150 },
        ],
        finalQuery: '',
      };

      const handle = storeHandle(result);

      const queryResult = await queryHandle(
        `SELECT id, value FROM ${handle} WHERE value > 100 ORDER BY value`,
      );

      expect(queryResult.rows).toEqual([
        { id: 3, value: 150 },
        { id: 2, value: 200 },
      ]);
    });

    it('handles aggregate queries on handle data', async () => {
      const result: QueryResult = {
        columns: ['category', 'amount'],
        types: ['VARCHAR', 'DOUBLE'],
        rows: [
          { category: 'A', amount: 10 },
          { category: 'A', amount: 20 },
          { category: 'B', amount: 30 },
        ],
        finalQuery: '',
      };

      const handle = storeHandle(result);

      const queryResult = await queryHandle(
        `SELECT category, SUM(amount) as total FROM ${handle} GROUP BY category ORDER BY category`,
      );

      expect(queryResult.rows).toEqual([
        { category: 'A', total: 30 },
        { category: 'B', total: 30 },
      ]);
    });

    it('supports joining multiple handles', async () => {
      const orders: QueryResult = {
        columns: ['order_id', 'product_id', 'qty'],
        types: ['INT', 'INT', 'INT'],
        rows: [
          { order_id: 1, product_id: 100, qty: 2 },
          { order_id: 2, product_id: 101, qty: 1 },
        ],
        finalQuery: '',
      };
      const products: QueryResult = {
        columns: ['product_id', 'name'],
        types: ['INT', 'VARCHAR'],
        rows: [
          { product_id: 100, name: 'Widget' },
          { product_id: 101, name: 'Gadget' },
        ],
        finalQuery: '',
      };

      const ordersHandle = storeHandle(orders);
      const productsHandle = storeHandle(products);

      const queryResult = await queryHandle(
        `SELECT o.order_id, p.name, o.qty
         FROM ${ordersHandle} o
         JOIN ${productsHandle} p ON o.product_id = p.product_id
         ORDER BY o.order_id`,
      );

      expect(queryResult.rows).toEqual([
        { order_id: 1, name: 'Widget', qty: 2 },
        { order_id: 2, name: 'Gadget', qty: 1 },
      ]);
    });
  });
});
