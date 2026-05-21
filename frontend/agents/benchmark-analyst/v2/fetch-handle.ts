// FetchHandle tool: pagination over stored results
// Ergonomic "more rows of what I already have" operation

import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext } from '../types';
import { fetchHandle } from './handle-store';
import { computeResultStats, type ResultStats } from './result-stats';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';

const FetchHandleParams = Type.Object({
  handle: Type.String({ description: 'The handle ID returned from a previous query (e.g. "handle_abc123")' }),
  offset: Type.Optional(Type.Number({ description: 'Row offset to start from (default: 0)', minimum: 0 })),
  length: Type.Optional(Type.Number({ description: 'Number of rows to return (default: 100, max: 1000)', minimum: 1, maximum: 1000 })),
});

interface FetchHandleDetails {
  handle: string;
  offset: number;
  length: number;
  rowCount: number;
}

export class FetchHandleV2 extends MXTool<
  typeof FetchHandleParams,
  BenchmarkAnalystContext,
  FetchHandleDetails
> {
  static readonly schema: Tool<typeof FetchHandleParams> = {
    name: 'fetchHandle',
    description: `Retrieve more rows from a stored query result by handle. Use for pagination over large results.
Returns {preview, stats} for the requested slice. No SQL needed — just the handle ID from a previous ExecuteQuery or SearchDBSchema call.

Example:
- First call: ExecuteQuery returns handle_abc with 10,000 rows, preview shows first 100
- To see rows 100-199: fetchHandle(handle="handle_abc", offset=100, length=100)
- To see rows 500-599: fetchHandle(handle="handle_abc", offset=500, length=100)

The stats always reflect the full result set, not just the slice.`,
    parameters: FetchHandleParams,
  };

  async run(): Promise<ToolResponse<FetchHandleDetails>> {
    const { handle, offset = 0, length = 100 } = this.parameters;

    // Validate offset
    if (offset < 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'offset must be >= 0' }) }],
        isError: true,
        details: { handle, offset, length, rowCount: 0 },
      };
    }

    // Validate length
    if (length <= 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'length must be > 0' }) }],
        isError: true,
        details: { handle, offset, length, rowCount: 0 },
      };
    }

    // Fetch the stored result
    const result = fetchHandle(handle);
    if (!result) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Handle '${handle}' not found. Use a handle returned from ExecuteQuery or SearchDBSchema.` }) }],
        isError: true,
        details: { handle, offset, length, rowCount: 0 },
      };
    }

    const rowCount = result.rows.length;

    // Slice the rows
    const slicedRows = result.rows.slice(offset, offset + length);
    const slicedResult = {
      columns: result.columns,
      types: result.types,
      rows: slicedRows,
    };

    // Compute preview (compressed)
    const compressed = compressQueryResult(slicedResult, TOOL_MAX_LIMIT_CHARS);

    // Compute stats for the full result, but note the preview count
    const stats = computeResultStats(result, slicedRows.length);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          preview: compressed.data,
          stats,
        }),
      }],
      isError: false,
      details: { handle, offset, length, rowCount },
    };
  }
}
