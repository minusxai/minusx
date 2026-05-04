import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { RunContext, ToolResult } from '@/orchestrator/types';
import { readFilesServer } from '@/lib/api/file-state.server';
import '../types';

const SCHEMA = Type.Object({
  fileIds: Type.Array(Type.Integer(), { description: 'Array of file IDs to load' }),
  maxChars: Type.Optional(Type.Integer({ description: 'Max characters of table data per query result (default 10,000, max 100,000)' })),
  runQueries: Type.Optional(Type.Boolean({ description: 'Execute queries to include fresh data (default true)' })),
});

const READ_FILES_DESCRIPTION = `Load files with their content, references, and cached query results.

Returns each file as CompressedAugmentedFile: fileState, references, and queryResults
as compressed GFM markdown tables.

Chart images (for question files with a rendered chart) are returned as full-fidelity
image blocks — they are never truncated.

Text table data (queryResults[].data) is truncated at maxChars characters (default 10,000):
- truncated: true means the result was cut short; totalRows shows the full row count.
- Increase maxChars (up to 100,000) to see more rows in text form.
- To page through rows, use ExecuteQuery with OFFSET in the SQL.
- Set runQueries: false to skip query execution and load only file metadata.

Only call this for files NOT already in AppState or AppState.references — calling it for
files already in AppState is wasteful and redundant.`;

export class ReadFiles extends Tool<typeof SCHEMA> {
  readonly name = 'ReadFiles';
  readonly description = READ_FILES_DESCRIPTION;
  readonly schema = SCHEMA;

  async run({ fileIds, runQueries }: Static<typeof SCHEMA>, ctx: RunContext): Promise<ToolResult> {
    if (!ctx.user) {
      return { state: 'failure', error: 'ReadFiles requires authenticated user context' };
    }
    const files = await readFilesServer(fileIds, ctx.user, { executeQueries: runQueries ?? false });
    return { state: 'success', content: { files } };
  }
}
