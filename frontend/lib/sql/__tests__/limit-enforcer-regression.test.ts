/**
 * Regression: enforceQueryLimit must NEVER emit a JSON blob as "SQL".
 *
 * Bug seen in production (BigQuery): a complex query (CTE / UNION ALL / FORMAT())
 * parsed fine but @polyglot-sql/sdk's generate() failed to regenerate SQL from
 * the AST. regenerateSql() then fell back to `JSON.stringify(ast)`, so the
 * database received a string starting with "{" and reported:
 *   Syntax error: Unexpected "{" at [1:1]
 *
 * Limit enforcement is best-effort: if regeneration fails for ANY reason
 * (generate throws, or returns no SQL), the ORIGINAL query must be returned
 * unmodified — never a JSON dump of the AST.
 *
 * The local SDK version regenerates these queries fine, so we can't reproduce
 * the failure with a real query. Instead we deterministically simulate the
 * production failure by making generate() yield no SQL.
 */

vi.mock('@polyglot-sql/sdk', async (importActual) => {
  const actual = await importActual<typeof import('@polyglot-sql/sdk')>();
  return {
    ...actual,
    // parse() stays real so enforceQueryLimit reaches the regeneration step.
    generate: vi.fn(),
  };
});

import { generate } from '@polyglot-sql/sdk';
import { enforceQueryLimit } from '../limit-enforcer';

const mockGenerate = vi.mocked(generate);

// Simulate the production failure mode: generate() returns no usable SQL.
const yieldsNoSql = () => ({ sql: [] }) as unknown as ReturnType<typeof generate>;

const SIMPLE_SELECT = 'SELECT a, b FROM my_table';
const COMPOUND = 'SELECT 1 AS x UNION ALL SELECT 2 AS x';

describe('enforceQueryLimit — regeneration failure must not emit JSON', () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockImplementation(yieldsNoSql);
  });

  it('simple SELECT: returns the original SQL, not a JSON AST blob', async () => {
    const out = await enforceQueryLimit(SIMPLE_SELECT, { dialect: 'bigquery' });

    expect(out.trimStart().startsWith('{')).toBe(false);
    expect(out).toBe(SIMPLE_SELECT);
  });

  it('compound UNION: returns the original SQL, not a JSON AST blob', async () => {
    const out = await enforceQueryLimit(COMPOUND, { dialect: 'bigquery' });

    expect(out.trimStart().startsWith('{')).toBe(false);
    expect(out).toBe(COMPOUND);
  });
});
