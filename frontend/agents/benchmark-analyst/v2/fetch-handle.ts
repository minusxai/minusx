/**
 * fetchHandle tool: Pagination over a stored query result.
 * Returns a preview slice + stats. Thin, obviously cheap — no SQL, no prompt.
 */

import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import type { BenchmarkAnalystContext } from '../types';
import { getHandle } from './handle-store';
import { computeResultStats } from './result-stats';
import { compressQueryResult, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';

const DEFAULT_LENGTH = 100;
const MAX_LENGTH = 1000;

const FetchHandleParams = Type.Object({
  handle: Type.String({ description: 'The handle ID returned by a previous query (e.g., "handle_1_abc123")' }),
  offset: Type.Optional(Type.Number({ description: 'Row offset to start from (0-indexed, default 0)', minimum: 0 })),
  length: Type.Optional(Type.Number({ description: `Number of rows to fetch (default ${DEFAULT_LENGTH}, max ${MAX_LENGTH})`, minimum: 1, maximum: MAX_LENGTH })),
});

interface FetchHandleDetails extends Record<string, unknown> {
  handle: string;
  offset: number;
  length: number;
  rowsReturned: number;
  totalRows: number;
}

export class FetchHandle extends MXTool<
  typeof FetchHandleParams,
  BenchmarkAnalystContext,
  FetchHandleDetails
> {
  static readonly schema: Tool<typeof FetchHandleParams> = {
    name: 'fetchHandle',
    description: `Fetch rows from a previously stored query result by handle ID. Use this to paginate through large results without re-running the query.

Returns:
- preview: Markdown table of the requested rows
- stats: Per-column statistics (min/max/avg for numeric, cardinality/topValues for categorical)

Example:
  fetchHandle({handle: "handle_1_abc", offset: 100, length: 50})
  → rows 100-149 of the stored result`,
    parameters: FetchHandleParams,
  };

  async run(): Promise<ToolResponse<FetchHandleDetails>> {
    const { handle, offset = 0, length = DEFAULT_LENGTH } = this.parameters;

    const stored = getHandle(handle);
    if (!stored) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Handle '${handle}' not found. Use a handle returned by ExecuteQuery or SearchDBSchema.` }) }],
        isError: true,
        details: { handle, offset, length, rowsReturned: 0, totalRows: 0 },
      };
    }

    const { result } = stored;
    const totalRows = result.rows.length;
    const clampedLength = Math.min(length, MAX_LENGTH);
    const slice = result.rows.slice(offset, offset + clampedLength);

    const sliceResult = {
      columns: result.columns,
      types: result.types,
      rows: slice,
    };

    const compressed = compressQueryResult(sliceResult, TOOL_MAX_LIMIT_CHARS);
    const stats = computeResultStats(result, slice.length);

    const response = {
      success: true,
      handle,
      preview: compressed.data,
      stats,
      pagination: {
        offset,
        length: slice.length,
        totalRows,
        hasMore: offset + slice.length < totalRows,
      },
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: false,
      details: { handle, offset, length: clampedLength, rowsReturned: slice.length, totalRows },
    };
  }
}
