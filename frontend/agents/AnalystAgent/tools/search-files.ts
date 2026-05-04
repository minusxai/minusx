import { Type, type Static } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/tool';
import type { RunContext, ToolResult } from '@/orchestrator/types';
import { searchFilesInFolder } from '@/lib/search/file-search';
import type { FileType } from '@/lib/types';
import '../types';

const SCHEMA = Type.Object({
  query: Type.String({ description: 'Search term to find in file names, descriptions, and content' }),
  file_types: Type.Optional(Type.Array(Type.String(), { description: "File types to search: 'question', 'dashboard'. Default: both" })),
  folder_path: Type.Optional(Type.String({ description: "Folder path to search within (default: user's home folder)" })),
  depth: Type.Optional(Type.Integer({ description: 'Folder depth to search (default: 999)' })),
  limit: Type.Optional(Type.Integer({ description: 'Maximum number of results (default: 20)' })),
  offset: Type.Optional(Type.Integer({ description: 'Number of results to skip (default: 0)' })),
});

const SEARCH_FILES_DESCRIPTION = `Search files by name, description, or content across questions and dashboards.
- Purpose: Find existing questions/dashboards that might be relevant
- Returns: Ranked results with match snippets showing WHERE the query matched
- Example: SearchFiles(query="revenue analysis") to find revenue-related files`;

export class SearchFiles extends Tool<typeof SCHEMA> {
  readonly name = 'SearchFiles';
  readonly description = SEARCH_FILES_DESCRIPTION;
  readonly schema = SCHEMA;

  async run(args: Static<typeof SCHEMA>, ctx: RunContext): Promise<ToolResult> {
    if (!ctx.user) {
      return { state: 'failure', error: 'SearchFiles requires authenticated user context' };
    }
    const result = await searchFilesInFolder(
      {
        query: args.query,
        file_types: args.file_types as FileType[] | undefined,
        folder_path: args.folder_path,
        depth: args.depth ?? 999,
        limit: args.limit ?? 20,
        offset: args.offset ?? 0,
        visibility: 'all',
      },
      ctx.user,
    );
    return { state: 'success', content: { ...result } };
  }
}
