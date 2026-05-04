import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { RunContext, ToolResult } from '@/orchestrator/src/types';
import { searchFilesInFolder } from '@/lib/search/file-search';
import type { FileType } from '@/lib/types';
import '../types';

interface Args {
  query: string;
  file_types?: string[];
  folder_path?: string;
  depth?: number;
  limit?: number;
  offset?: number;
}

const SEARCH_FILES_DESCRIPTION = `Search files by name, description, or content across questions and dashboards.
- Purpose: Find existing questions/dashboards that might be relevant
- Returns: Ranked results with match snippets showing WHERE the query matched
- Example: SearchFiles(query="revenue analysis") to find revenue-related files`;

export class SearchFiles extends Tool<Args> {
  readonly name = 'SearchFiles';
  readonly description = SEARCH_FILES_DESCRIPTION;
  readonly schema = Type.Object({
    query: Type.String({ description: 'Search term to find in file names, descriptions, and content' }),
    file_types: Type.Optional(Type.Array(Type.String(), { description: "File types to search: 'question', 'dashboard'. Default: both" })),
    folder_path: Type.Optional(Type.String({ description: "Folder path to search within (default: user's home folder)" })),
    depth: Type.Optional(Type.Integer({ description: 'Folder depth to search (default: 999)' })),
    limit: Type.Optional(Type.Integer({ description: 'Maximum number of results (default: 20)' })),
    offset: Type.Optional(Type.Integer({ description: 'Number of results to skip (default: 0)' })),
  });

  async run(args: Args, ctx: RunContext): Promise<ToolResult> {
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
