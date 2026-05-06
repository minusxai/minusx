import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, UserInputException, type ToolResponse } from '@/orchestrator/types';
import type { RemoteAnalystContext } from '@/agents/analyst/types';

// All three tools below execute in the browser via the existing
// `executeToolCall` registry (lib/api/tool-handlers.ts). Server-side they
// throw UserInputException so the orchestrator pauses; the bridge (Redux
// listener middleware) calls `executeToolCall(...)` for real and resumes the
// orchestrator with the resulting ToolResultMessage.

const EditFileParams = Type.Object({
  fileId: Type.Number(),
  oldStr: Type.String({ description: 'Existing substring to replace.' }),
  newStr: Type.String({ description: 'Replacement text.' }),
});

export class EditFile extends MXTool<typeof EditFileParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof EditFileParams> = {
    name: 'EditFile',
    description: 'Edit an existing file by replacing one substring with another. Executes on the frontend with real Redux state.',
    parameters: EditFileParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

const CreateFileParams = Type.Object({
  name: Type.String(),
  path: Type.String(),
  type: Type.String({ description: 'File type (question, dashboard, etc.).' }),
  content: Type.Unknown({ description: 'Initial file content (typed by file type).' }),
});

export class CreateFile extends MXTool<typeof CreateFileParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof CreateFileParams> = {
    name: 'CreateFile',
    description: 'Create a new file in the user\'s workspace. Executes on the frontend with real Redux state.',
    parameters: CreateFileParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

const DeleteFileParams = Type.Object({
  fileId: Type.Number(),
});

export class DeleteFile extends MXTool<typeof DeleteFileParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof DeleteFileParams> = {
    name: 'DeleteFile',
    description: 'Delete a file from the user\'s workspace. Executes on the frontend with real Redux state.',
    parameters: DeleteFileParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}
