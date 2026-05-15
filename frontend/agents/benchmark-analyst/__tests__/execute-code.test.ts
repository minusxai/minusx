import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import RealDatabase from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { BaseExecuteQuery } from '../db-tools';
import { ExecuteCode } from '../execute-code';
import type { BenchmarkAnalystContext } from '../types';

describe('ExecuteCode', () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'execute-code-'));
    sqlitePath = path.join(tmpDir, 'test.sqlite');
    const db = new RealDatabase(sqlitePath);
    db.exec(`
      CREATE TABLE sales (product_id INTEGER, revenue REAL, category TEXT);
      INSERT INTO sales VALUES (1, 100.0, 'electronics');
      INSERT INTO sales VALUES (2, 200.0, 'electronics');
      INSERT INTO sales VALUES (3, 50.0, 'books');
      INSERT INTO sales VALUES (4, 75.0, 'books');

      CREATE TABLE products (id INTEGER, name TEXT);
      INSERT INTO products VALUES (1, 'Phone');
      INSERT INTO products VALUES (2, 'Laptop');
      INSERT INTO products VALUES (3, 'Novel');
      INSERT INTO products VALUES (4, 'Textbook');
    `);
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const ctx = (): BenchmarkAnalystContext => ({
    connections: [{ name: 'db', dialect: 'sqlite', config: { file_path: sqlitePath } }],
  });

  /** Run ExecuteQuery with a label, populating ctx.labeledResults. */
  async function runLabeledQuery(
    context: BenchmarkAnalystContext,
    query: string,
    label: string,
  ) {
    const tool = new BaseExecuteQuery(
      undefined as never,
      { connectionId: 'db', query, label },
      context,
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);
    return res;
  }

  it('errors when no labeled results are available', async () => {
    const context = ctx();
    const tool = new ExecuteCode(
      undefined as never,
      { code: '() => sales' },
      context,
    );
    const res = await tool.run();
    expect(res.isError).toBe(true);
    const content = JSON.parse(res.content[0].type === 'text' ? res.content[0].text : '');
    expect(content.success).toBe(false);
    expect(content.error).toContain('No labeled results');
  });

  it('executes a function with polars code and returns results', async () => {
    const context = ctx();
    await runLabeledQuery(context, 'SELECT * FROM sales', 'sales');

    const tool = new ExecuteCode(
      undefined as never,
      {
        code: `() => { return sales.groupBy("category").agg(pl.col("revenue").sum()).sort("category"); }`,
      },
      context,
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);

    const content = JSON.parse(res.content[0].type === 'text' ? res.content[0].text : '');
    expect(content.success).toBe(true);
    expect(content.columns).toContain('category');
    expect(content.columns).toContain('revenue');

    // Check the details have full rows
    expect(res.details?.success).toBe(true);
    const rows = res.details?.queryResult?.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    // books: 50 + 75 = 125, electronics: 100 + 200 = 300
    const books = rows.find((r) => r.category === 'books');
    const electronics = rows.find((r) => r.category === 'electronics');
    expect(books?.revenue).toBe(125);
    expect(electronics?.revenue).toBe(300);
  });

  it('supports multiple labeled DataFrames and joins', async () => {
    const context = ctx();
    await runLabeledQuery(context, 'SELECT * FROM sales', 'sales');
    await runLabeledQuery(context, 'SELECT * FROM products', 'products');

    const tool = new ExecuteCode(
      undefined as never,
      {
        code: `() => { return sales.join(products, {leftOn: "product_id", rightOn: "id"}).select("name", "revenue").sort("name"); }`,
      },
      context,
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);

    const rows = res.details?.queryResult?.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(4);
    expect(rows[0].name).toBe('Laptop');
    expect(rows[0].revenue).toBe(200);
  });

  it('returns scalar results as JSON', async () => {
    const context = ctx();
    await runLabeledQuery(context, 'SELECT * FROM sales', 'sales');

    const tool = new ExecuteCode(
      undefined as never,
      { code: `() => { return sales.shape; }` },
      context,
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);

    const content = JSON.parse(res.content[0].type === 'text' ? res.content[0].text : '');
    expect(content.success).toBe(true);
    const result = JSON.parse(content.result);
    expect(result.height).toBe(4);
    expect(result.width).toBe(3);
  });

  it('returns code execution errors cleanly', async () => {
    const context = ctx();
    await runLabeledQuery(context, 'SELECT * FROM sales', 'sales');

    const tool = new ExecuteCode(
      undefined as never,
      { code: `() => { return sales.select("nonexistent_column"); }` },
      context,
    );
    const res = await tool.run();
    expect(res.isError).toBe(true);
    const content = JSON.parse(res.content[0].type === 'text' ? res.content[0].text : '');
    expect(content.success).toBe(false);
    expect(content.error).toBeDefined();
  });

  it('reports available labels in error responses', async () => {
    const context = ctx();
    await runLabeledQuery(context, 'SELECT * FROM sales', 'sales');
    await runLabeledQuery(context, 'SELECT * FROM products', 'products');

    const tool = new ExecuteCode(
      undefined as never,
      { code: `() => { throw new Error("intentional"); }` },
      context,
    );
    const res = await tool.run();
    expect(res.isError).toBe(true);
    expect(res.details?.availableLabels).toEqual(['sales', 'products']);
  });

  it('supports simple-statistics via ss', async () => {
    const context = ctx();
    await runLabeledQuery(context, 'SELECT * FROM sales', 'sales');

    const tool = new ExecuteCode(
      undefined as never,
      { code: `() => { const revenues = sales.getColumn("revenue").toArray(); return { mean: ss.mean(revenues), std: ss.standardDeviation(revenues) }; }` },
      context,
    );
    const res = await tool.run();
    expect(res.isError).toBe(false);

    const content = JSON.parse(res.content[0].type === 'text' ? res.content[0].text : '');
    expect(content.success).toBe(true);
    const result = JSON.parse(content.result);
    expect(result.mean).toBeCloseTo(106.25);
    expect(result.std).toBeGreaterThan(0);
  });
});
