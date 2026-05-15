// ExecuteCode: runs user-supplied nodejs-polars code against labeled
// DataFrames from prior ExecuteQuery calls. Benchmark-only — not wired
// into the production analyst path.

import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { type BenchmarkAnalystContext, type LabeledQueryResult } from './types';
import { compressQueryResult, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import pl from 'nodejs-polars';
import * as ss from 'simple-statistics';
import vm from 'node:vm';

// ─── helpers ──────────────────────────────────────────────────────────────

/** Convert a LabeledQueryResult into a nodejs-polars DataFrame. */
function resultToDataFrame(result: LabeledQueryResult): pl.DataFrame {
  const data: Record<string, unknown[]> = {};
  for (const col of result.columns) {
    data[col] = result.rows.map((row) => row[col] ?? null);
  }
  return pl.DataFrame(data);
}

/**
 * Duck-type check: does `value` look like a polars DataFrame?
 * `instanceof` doesn't work across vm contexts (different prototype chain),
 * so we check for the shape instead.
 */
function isDataFrameLike(value: unknown): value is {
  columns: string[];
  dtypes: { toString(): string }[];
  toRecords(): Record<string, unknown>[];
} {
  return (
    value != null &&
    typeof value === 'object' &&
    Array.isArray((value as Record<string, unknown>).columns) &&
    Array.isArray((value as Record<string, unknown>).dtypes) &&
    typeof (value as Record<string, unknown>).toRecords === 'function'
  );
}

/** Duck-type check: does `value` look like a polars Series? */
function isSeriesLike(value: unknown): value is {
  name: string;
  dtype: { toString(): string };
  toArray(): unknown[];
} {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).name === 'string' &&
    typeof (value as Record<string, unknown>).toArray === 'function' &&
    (value as Record<string, unknown>).dtype != null &&
    typeof ((value as Record<string, unknown>).dtype as Record<string, unknown>)?.toString === 'function'
  );
}

// ─── ListLabeledResults ──────────────────────────────────────────────────

const ListLabeledResultsParams = Type.Object({});

export class ListLabeledResults extends MXTool<typeof ListLabeledResultsParams, BenchmarkAnalystContext> {
  static readonly schema: Tool<typeof ListLabeledResultsParams> = {
    name: 'ListLabeledResults',
    description:
      'List all labeled query results stored by prior ExecuteQuery calls (with `label` parameter). Shows each label, column names, row count, and the first 3 rows as a preview. Use this to check what data is available before calling ExecuteCode.',
    parameters: ListLabeledResultsParams,
  };

  async run(): Promise<ToolResponse> {
    const labeled = this.context.labeledResults;
    if (!labeled || labeled.size === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          labels: [],
          message: 'No labeled results. Run ExecuteQuery with a `label` parameter first.',
        }) }],
        isError: false,
      };
    }

    const summaries = Array.from(labeled.entries()).map(([label, result]) => ({
      label,
      columns: result.columns,
      types: result.types,
      totalRows: result.rows.length,
      preview: result.rows.slice(0, 3),
    }));

    return {
      content: [{ type: 'text', text: JSON.stringify({ labels: summaries }) }],
      isError: false,
    };
  }
}

// ─── ExecuteCode ────────────────────────────────────────────────────────

const ExecuteCodeParams = Type.Object({
  code: Type.String({
    description:
      'A complete JavaScript function to execute. All labeled DataFrames (from prior ExecuteQuery calls with `label`) are available as closure variables. Available modules: `pl` (nodejs-polars) for DataFrame operations, `ss` (simple-statistics) for statistical functions — nothing else. Example: `() => { const joined = sales.join(products, {on: "product_id"}); return joined.groupBy("category").agg(pl.col("revenue").sum()); }`',
  }),
  maxChars: Type.Optional(Type.Number({
    description: 'Max characters of the markdown table returned (default 10,000, max 100,000).',
  })),
});

interface ExecuteCodeDetails extends Record<string, unknown> {
  success: boolean;
  queryResult?: { columns: string[]; types: string[]; rows: Record<string, unknown>[] };
  error?: string;
  executionMs?: number;
  availableLabels?: string[];
}

const CODE_TIMEOUT_MS = 30_000;

export class ExecuteCode extends MXTool<typeof ExecuteCodeParams, BenchmarkAnalystContext, ExecuteCodeDetails> {
  static readonly schema: Tool<typeof ExecuteCodeParams> = {
    name: 'ExecuteCode',
    description:
      'Execute a JavaScript function against labeled DataFrames from prior ExecuteQuery calls. First, run ExecuteQuery with a `label` parameter to store results (e.g. label="sales"). Then call this tool with a complete function that references those labels. Available modules: `pl` (nodejs-polars) for DataFrame ops, `ss` (simple-statistics) for regression, hypothesis testing, correlation, distributions — nothing else. Returns the result as a markdown table (for DataFrames/Series) or JSON (for scalars).',
    parameters: ExecuteCodeParams,
  };

  async run(): Promise<ToolResponse<ExecuteCodeDetails>> {
    const { code } = this.parameters;
    const maxChars = Math.min(
      this.parameters.maxChars ?? TOOL_DEFAULT_LIMIT_CHARS,
      TOOL_MAX_LIMIT_CHARS,
    );

    const labeled = this.context.labeledResults;
    if (!labeled || labeled.size === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: false,
          error: 'No labeled results available. Run ExecuteQuery with a `label` parameter first (e.g. ExecuteQuery({..., label: "sales"})).',
        }) }],
        isError: true,
        details: { success: false, error: 'No labeled results', availableLabels: [] },
      };
    }

    const start = Date.now();

    // Build sandbox with pl module, stats library, and all labeled DataFrames.
    const sandbox: Record<string, unknown> = { pl, ss };
    const availableLabels: string[] = [];
    for (const [label, result] of labeled) {
      sandbox[label] = resultToDataFrame(result);
      availableLabels.push(label);
    }

    // Execute the code in a sandboxed context.
    let rawResult: unknown;
    try {
      // The agent writes a complete function; we invoke it immediately.
      const wrappedCode = `(${code})()`;
      const script = new vm.Script(wrappedCode, { filename: 'execute-code.js' });
      const ctx = vm.createContext(sandbox);
      rawResult = await script.runInContext(ctx, { timeout: CODE_TIMEOUT_MS });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: false,
          error: `Code execution error: ${errMsg}`,
          availableLabels,
        }) }],
        isError: true,
        details: { success: false, error: errMsg, availableLabels, executionMs: Date.now() - start },
      };
    }
    const executionMs = Date.now() - start;

    // Convert result to a response using duck-typing (instanceof doesn't
    // work across vm contexts).
    try {
      if (isDataFrameLike(rawResult)) {
        const columns = rawResult.columns;
        const types = rawResult.dtypes.map((dt) => dt.toString());
        const rows = rawResult.toRecords();
        const compressed = compressQueryResult({ columns, types, rows }, maxChars);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, ...compressed }) }],
          isError: false,
          details: { success: true, queryResult: { columns, types, rows }, executionMs, availableLabels },
        };
      }

      if (isSeriesLike(rawResult)) {
        const name = rawResult.name || 'value';
        const values = rawResult.toArray();
        const columns = [name];
        const types = [rawResult.dtype.toString()];
        const rows = values.map((v: unknown) => ({ [name]: v }));
        const compressed = compressQueryResult({ columns, types, rows }, maxChars);
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, ...compressed }) }],
          isError: false,
          details: { success: true, queryResult: { columns, types, rows }, executionMs, availableLabels },
        };
      }

      // Scalar or other value
      const text = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, result: text }) }],
        isError: false,
        details: { success: true, executionMs, availableLabels },
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: false,
          error: `Result conversion error: ${errMsg}`,
        }) }],
        isError: true,
        details: { success: false, error: errMsg, executionMs, availableLabels },
      };
    }
  }
}
