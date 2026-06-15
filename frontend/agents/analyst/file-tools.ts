import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { searchFilesInFolder } from '@/lib/search/file-search';
import { readFilesServer } from '@/lib/api/file-state.server';
import { TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS } from '@/lib/api/compress-augmented';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { FileType, ReadFilesResult } from '@/lib/types';
import type { AnalystAgentContext } from './types';

/**
 * Discriminated return: either the resolved EffectiveUser, or an error
 * ToolResponse the caller should bubble straight up.
 */
function requireUser(
  ctx: AnalystAgentContext,
  toolName: string,
): EffectiveUser | ToolResponse {
  if (!ctx.effectiveUser) {
    return {
      content: [{ type: 'text', text: `${toolName} requires effectiveUser in AgentContext.` }],
      isError: true,
    };
  }
  return ctx.effectiveUser;
}

async function tryRun<TDetails = Record<string, unknown>>(
  fn: () => Promise<ToolResponse<TDetails>>,
): Promise<ToolResponse<TDetails>> {
  try {
    return await fn();
  } catch (err) {
    return {
      content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      isError: true,
    };
  }
}

// ─── ReadFiles ───────────────────────────────────────────────────────────────

// Params mirror the frontend-bridge ReadFiles (lib/api/tool-handlers.ts) so the model
// sees one tool regardless of where it executes.
const ReadFilesParams = Type.Object({
  fileIds: Type.Array(Type.Number(), { description: 'IDs of files to load.' }),
  maxChars: Type.Optional(Type.Number({ description: 'Max characters of compressed text per file (default 10,000).' })),
  runQueries: Type.Optional(Type.Boolean({ description: 'When true, executes saved queries and returns their results (default false).' })),
});

export class ReadFiles extends MXTool<typeof ReadFilesParams, AnalystAgentContext> {
  static readonly schema: Tool<typeof ReadFilesParams> = {
    name: 'ReadFiles',
    description: 'Load one or more files by integer ID with their references and (optionally) executed query results. Returns the same compressed file shape as AppState.',
    parameters: ReadFilesParams,
  };

  async run(): Promise<ToolResponse> {
    const user = requireUser(this.context, 'ReadFiles');
    if ('isError' in user) return user;
    return tryRun(async () => {
      const maxChars = Math.min(this.parameters.maxChars ?? TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS);
      // Route through readFilesServer — the canonical server builder that
      // file-state-server-parity.test.ts certifies as identical to the live client AppState.
      const files = await readFilesServer(this.parameters.fileIds, user, {
        executeQueries: this.parameters.runQueries ?? false,
        maxChars,
      });
      const result: ReadFilesResult = { success: true, files };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
    });
  }
}

// ─── SearchFiles ─────────────────────────────────────────────────────────────

const SearchFilesParams = Type.Object({
  query: Type.String({ description: 'Search term to find in file names, descriptions, and content.' }),
  file_types: Type.Optional(Type.Array(Type.String(), {
    description: 'File types to search: "question", "dashboard". Default: both.',
  })),
  folder_path: Type.Optional(Type.String({
    description: 'Folder path to search within (default: user\'s home folder).',
  })),
  depth: Type.Optional(Type.Number({
    description: 'Folder depth to search (default 999 — all subfolders).',
  })),
  limit: Type.Optional(Type.Number({
    description: 'Maximum number of results to return (default 20).',
  })),
  offset: Type.Optional(Type.Number({
    description: 'Number of results to skip for pagination (default 0).',
  })),
});

interface SearchFilesDetails extends Record<string, unknown> {
  success: boolean;
  results: unknown[];
  total: number;
}

export class SearchFiles extends MXTool<typeof SearchFilesParams, AnalystAgentContext, SearchFilesDetails> {
  static readonly schema: Tool<typeof SearchFilesParams> = {
    name: 'SearchFiles',
    description: 'Search files by name, description, or content with ranked results and snippets. Returns {success, results: [{id, name, path, type, score, snippets}], total}.',
    parameters: SearchFilesParams,
  };

  async run(): Promise<ToolResponse<SearchFilesDetails>> {
    const user = requireUser(this.context, 'SearchFiles');
    if ('isError' in user) {
      return user as ToolResponse<SearchFilesDetails>;
    }
    return tryRun(async () => {
      const result = await searchFilesInFolder(
        {
          query: this.parameters.query,
          file_types: this.parameters.file_types as FileType[] | undefined,
          folder_path: this.parameters.folder_path,
          depth: this.parameters.depth ?? 999,
          limit: this.parameters.limit ?? 20,
          offset: this.parameters.offset ?? 0,
          visibility: 'all',
        },
        user,
      );
      // searchFilesInFolder returns whatever shape it has; normalize to
      // {success, results, total}. Pass through unknown
      // result fields under spread so we don't lose data.
      const r = result as { results?: unknown[]; total?: number; files?: unknown[] };
      const payload: SearchFilesDetails = {
        success: true,
        results: r.results ?? r.files ?? [],
        total: r.total ?? (r.results ?? r.files ?? []).length,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError: false,
        details: payload,
      };
    });
  }
}
