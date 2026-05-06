import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, type ToolResponse } from '@/orchestrator/types';
import { FilesAPI } from '@/lib/data/files.server';
import { searchFilesInFolder } from '@/lib/search/file-search';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { FileType } from '@/lib/types';
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

async function tryRun(fn: () => Promise<ToolResponse>): Promise<ToolResponse> {
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

const ReadFilesParams = Type.Object({
  fileIds: Type.Array(Type.Number()),
});

export class ReadFiles extends MXTool<typeof ReadFilesParams, AnalystAgentContext> {
  static readonly schema: Tool<typeof ReadFilesParams> = {
    name: 'ReadFiles',
    description: 'Load one or more files by integer ID. Returns full file objects with content.',
    parameters: ReadFilesParams,
  };

  async run(): Promise<ToolResponse> {
    const user = requireUser(this.context, 'ReadFiles');
    if ('isError' in user) return user;
    return tryRun(async () => {
      const result = await FilesAPI.loadFiles(this.parameters.fileIds, user);
      return { content: [{ type: 'text', text: JSON.stringify(result.data) }], isError: false };
    });
  }
}

// ─── SearchFiles ─────────────────────────────────────────────────────────────

const SearchFilesParams = Type.Object({
  query: Type.String(),
  file_types: Type.Optional(Type.Array(Type.String())),
  folder_path: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
});

export class SearchFiles extends MXTool<typeof SearchFilesParams, AnalystAgentContext> {
  static readonly schema: Tool<typeof SearchFilesParams> = {
    name: 'SearchFiles',
    description: 'Search files by name/content with ranking and snippets. Returns matching file metadata.',
    parameters: SearchFilesParams,
  };

  async run(): Promise<ToolResponse> {
    const user = requireUser(this.context, 'SearchFiles');
    if ('isError' in user) return user;
    return tryRun(async () => {
      const result = await searchFilesInFolder(
        {
          query: this.parameters.query,
          file_types: this.parameters.file_types as FileType[] | undefined,
          folder_path: this.parameters.folder_path,
          limit: this.parameters.limit ?? 20,
          visibility: 'all',
        },
        user,
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
    });
  }
}
