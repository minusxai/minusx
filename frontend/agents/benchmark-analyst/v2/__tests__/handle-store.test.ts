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
    it('stores a query result and returns a unique handle ID', async () => {
      const result: QueryResult = {
        columns: ['id', 'name'],
        types: ['INTEGER', 'VARCHAR'],
        rows: [{ id: 1, name: 'Alice' }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);

      expect(stored.handleId).toMatch(/^handle_/);
      expect(stored.error).toBeUndefined();
      expect(fetchHandle(stored.handleId)).toEqual(result);
    });

    it('generates unique handle IDs for each store call', async () => {
      const result: QueryResult = {
        columns: ['x'],
        types: ['INT'],
        rows: [{ x: 1 }],
        finalQuery: '',
      };

      const h1 = await storeHandle(result);
      const h2 = await storeHandle(result);
      const h3 = await storeHandle(result);

      expect(h1.handleId).not.toBe(h2.handleId);
      expect(h2.handleId).not.toBe(h3.handleId);
      expect(h1.handleId).not.toBe(h3.handleId);
    });

    it('returns undefined for unknown handle', () => {
      expect(fetchHandle('handle_unknown')).toBeUndefined();
    });

    it('stores result with empty rows', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [],
        finalQuery: '',
      };

      const stored = await storeHandle(result);
      expect(stored.error).toBeUndefined();
      expect(fetchHandle(stored.handleId)).toEqual(result);
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

      const h1 = await storeHandle(result);
      const h2 = await storeHandle(result);

      expect(fetchHandle(h1.handleId)).toBeDefined();
      expect(fetchHandle(h2.handleId)).toBeDefined();

      await clearHandles();

      expect(fetchHandle(h1.handleId)).toBeUndefined();
      expect(fetchHandle(h2.handleId)).toBeUndefined();
    });
  });

  describe('getHandleTable', () => {
    it('returns the DuckDB table name for a handle', async () => {
      const result: QueryResult = {
        columns: ['id'],
        types: ['INT'],
        rows: [{ id: 1 }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);
      const tableName = getHandleTable(stored.handleId);

      expect(tableName).toBe(stored.handleId);
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

      const { handleId } = await storeHandle(result);

      const queryResult = await queryHandle(
        `SELECT id, value FROM ${handleId} WHERE value > 100 ORDER BY value`,
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

      const { handleId } = await storeHandle(result);

      const queryResult = await queryHandle(
        `SELECT category, SUM(amount) as total FROM ${handleId} GROUP BY category ORDER BY category`,
      );

      expect(queryResult.rows).toEqual([
        { category: 'A', total: 30 },
        { category: 'B', total: 30 },
      ]);
    });

    // When the source query produces duplicate column names (e.g.
    // `SELECT MIN(a) AS min, MIN(b) AS min`), DuckDB's CREATE TABLE
    // rejects the registration. We don't try to rename or recover —
    // instead, `storeHandle` returns `{ handleId, error }`. The agent
    // gets an actionable error message and can fix the source query if
    // they need the handle for SQL joins. The raw rows remain accessible
    // via `fetchHandle` so the data isn't lost.
    it('returns an error (not a crash) when source columns collide', async () => {
      const result: QueryResult = {
        columns: ['min', 'max', 'min'],
        types: ['INTEGER', 'INTEGER', 'INTEGER'],
        rows: [{ min: 7, max: 99 }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);

      expect(stored.handleId).toMatch(/^handle_/);
      expect(stored.error).toBeDefined();
      // The DuckDB error mentions "min" (the colliding column name).
      expect(stored.error!).toMatch(/min/i);
    });

    it('still stores raw rows in the handle map even when registration fails', async () => {
      const result: QueryResult = {
        columns: ['min', 'min'],
        types: ['INTEGER', 'INTEGER'],
        rows: [{ min: 42 }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);
      expect(stored.error).toBeDefined();
      // Raw rows still accessible via fetchHandle — no data lost
      const fetched = fetchHandle(stored.handleId);
      expect(fetched).toEqual(result);
    });

    it('reports the error message verbatim when querying the un-registered handle fails', async () => {
      // `FROM handle_xyz` against a handle that never registered should
      // surface DuckDB's "table doesn't exist" — agent has been told it
      // wasn't registered (via handle_error), so this is the expected
      // downstream consequence.
      const result: QueryResult = {
        columns: ['x', 'x'],
        types: ['INTEGER', 'INTEGER'],
        rows: [{ x: 1 }],
        finalQuery: '',
      };

      const stored = await storeHandle(result);
      expect(stored.error).toBeDefined();
      await expect(queryHandle(`SELECT * FROM ${stored.handleId}`))
        .rejects.toThrow(/does not exist/i);
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

      const ordersHandle = (await storeHandle(orders)).handleId;
      const productsHandle = (await storeHandle(products)).handleId;

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
