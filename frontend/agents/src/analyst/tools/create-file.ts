import { Type } from '@sinclair/typebox';
import { Tool } from '@/orchestrator/src/tool';
import type { ToolResult } from '@/orchestrator/src/types';

interface Args {
  file_type: string;
  name?: string;
  path?: string;
  content?: Record<string, unknown>;
}

const CREATE_FILE_DESCRIPTION = `Create a new file of any type as a draft. No page navigation.

Creates the file immediately with a real positive ID. The file is hidden from folder
listings until the user publishes via the Save button or Publish All.

- file_type: any supported type ('question', 'dashboard', 'report', etc.)
- name: optional display name
- path: folder path to create in (e.g. '/org/reports'). Defaults to user's home folder.
- content: initial content fields merged on top of template defaults.

Returns: {success: true, state: {fileState, references, queryResults}}
The returned id is a real positive integer. Use it with EditFile immediately.`;

export class CreateFile extends Tool<Args> {
  readonly name = 'CreateFile';
  readonly description = CREATE_FILE_DESCRIPTION;
  readonly schema = Type.Object({
    file_type: Type.String({ description: "File type to create: 'question', 'dashboard', 'report', etc." }),
    name: Type.Optional(Type.String({ description: 'Display name for the new file' })),
    path: Type.Optional(Type.String({ description: 'Folder path (defaults to user\'s home folder)' })),
    content: Type.Optional(Type.Record(Type.String(), Type.Any(), {
      description: 'Initial content fields merged on top of template defaults',
    })),
  });

  async run(_args: Args): Promise<ToolResult> {
    return {
      state: 'failure',
      error: 'CreateFile is not available in server-run mode. File creation requires an interactive session.',
    };
  }
}
