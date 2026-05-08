import { Type, type Tool } from '@mariozechner/pi-ai';
import { MXTool, UserInputException, type ToolResponse } from '@/orchestrator/types';
import type { RemoteAnalystContext } from '@/agents/analyst/types';

// All tools below execute in the browser via the existing
// `executeToolCall` registry (lib/api/tool-handlers.ts). Server-side they
// throw UserInputException so the orchestrator pauses; the bridge (Redux
// listener middleware) calls `executeToolCall(...)` for real and resumes the
// orchestrator with the resulting ToolResultMessage. The Node side is a thin
// declaration — no logic, no reimplementation.

// ─── EditFile ────────────────────────────────────────────────────────────────
// Schema MUST match the runtime handler in `lib/api/tool-handlers.ts`
// (`registerFrontendTool('EditFile', ...)`) — the dual-update rule. The
// handler expects `changes: [{oldMatch, newMatch, replaceAll?}]`.
const EditFileParams = Type.Object({
  fileId: Type.Number(),
  changes: Type.Array(Type.Object({
    oldMatch: Type.String({ description: 'Existing substring to replace.' }),
    newMatch: Type.String({ description: 'Replacement text.' }),
    replaceAll: Type.Optional(Type.Boolean({ description: 'Replace every occurrence (default true).' })),
  })),
});

export class EditFile extends MXTool<typeof EditFileParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof EditFileParams> = {
    name: 'EditFile',
    description: 'Edit an existing file by applying one or more string replacements. Executes on the frontend with real Redux state.',
    parameters: EditFileParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// ─── CreateFile ──────────────────────────────────────────────────────────────
// Schema MUST match `registerFrontendTool('CreateFile', ...)` in
// `lib/api/tool-handlers.ts`. Handler reads `file_type`, `name`, `path`, `content`.
const CreateFileParams = Type.Object({
  file_type: Type.String({ description: 'File type to create (question, dashboard, folder, etc.).' }),
  name: Type.String(),
  path: Type.String(),
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

// ─── ReadFiles (frontend-bridge variant) ─────────────────────────────────────
// Replaces the server-side `ReadFiles` from `agents/analyst/file-tools.ts` for
// WebAnalystAgent. Server-side ReadFiles only sees persisted DB state; this
// frontend-bridge variant routes through `frontendToolRegistry.ReadFiles@448`
// which reads Redux file memory (drafts + persisted) and includes chart
// images. This matches Python's frontend-bridge ReadFiles behaviour so an
// agent that edits a draft and reads it back sees its in-flight edits.
const ReadFilesParams = Type.Object({
  fileIds: Type.Array(Type.Number(), { description: 'IDs of files to load.' }),
  maxChars: Type.Optional(Type.Number({ description: 'Max characters of compressed text per file (default 10,000).' })),
  runQueries: Type.Optional(Type.Boolean({ description: 'When true (default), executes saved queries and returns results.' })),
});

export class ReadFiles extends MXTool<typeof ReadFilesParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof ReadFilesParams> = {
    name: 'ReadFiles',
    description: 'Load one or more files by integer ID with their references and (optionally) executed query results. Reads in-flight Redux state including unpublished drafts.',
    parameters: ReadFilesParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// ─── Navigate ────────────────────────────────────────────────────────────────
// Schema matches `registerFrontendTool('Navigate', ...)` at line 275 — handler
// reads `file_id`, `path`, `newFileType`. All three are optional but at least
// one must be provided (handler enforces).
const NavigateParams = Type.Object({
  file_id: Type.Optional(Type.Union([Type.Number(), Type.String()], { description: 'Existing file ID to navigate to.' })),
  path: Type.Optional(Type.String({ description: 'Folder path to navigate to (or parent folder for newFileType).' })),
  newFileType: Type.Optional(Type.String({ description: 'Create a new draft of this file type and navigate to it (e.g. "question", "dashboard").' })),
});

export class Navigate extends MXTool<typeof NavigateParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof NavigateParams> = {
    name: 'Navigate',
    description: 'Navigate the user to a file, folder, or new draft of a given type. Always asks for confirmation before navigating.',
    parameters: NavigateParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// ─── ClarifyFrontend ─────────────────────────────────────────────────────────
// Schema matches `registerFrontendTool('ClarifyFrontend', ...)` at line 382 —
// handler reads `question`, `options[{label, description?}]`, `multiSelect?`.
// Naming: we expose the LLM-visible name as `ClarifyFrontend` (matches the
// frontend handler exactly, no spawn-wrapper needed). Python uses `Clarify`
// with a server-side spawn into `ClarifyFrontend`; Node v=2 short-circuits
// the spawn since our orchestrator dispatches by exact name.
const ClarifyFrontendParams = Type.Object({
  question: Type.String({ description: 'Question to ask the user.' }),
  options: Type.Array(Type.Object({
    label: Type.String({ description: 'Short label shown on the option button.' }),
    description: Type.Optional(Type.String({ description: 'Longer description shown beneath the label.' })),
  }), { description: 'Multiple-choice options the user can select from.' }),
  multiSelect: Type.Optional(Type.Boolean({ description: 'Allow selecting more than one option (default false).' })),
});

export class ClarifyFrontend extends MXTool<typeof ClarifyFrontendParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof ClarifyFrontendParams> = {
    name: 'ClarifyFrontend',
    description: 'Ask the user a multiple-choice clarifying question. Pauses the agent until the user picks. Use when an interpretation choice is needed and you cannot reasonably guess.',
    parameters: ClarifyFrontendParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// ─── PublishAll ──────────────────────────────────────────────────────────────
// Schema matches `registerFrontendTool('PublishAll', ...)` at line 871 —
// handler takes no arguments; the bridge surfaces a confirmation modal listing
// every dirty file before persisting.
const PublishAllParams = Type.Object({});

export class PublishAll extends MXTool<typeof PublishAllParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof PublishAllParams> = {
    name: 'PublishAll',
    description: 'Open the Publish modal for the user to review and commit all unsaved file changes. Use after EditFile/CreateFile to persist agent edits.',
    parameters: PublishAllParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// ─── LoadSkillFrontend ───────────────────────────────────────────────────────
// Schema matches `registerFrontendTool('LoadSkillFrontend', ...)` at line 201
// — handler reads `name` (the skill name to load from the active context).
const LoadSkillFrontendParams = Type.Object({
  name: Type.String({ description: 'Skill name to load from the user\'s active Knowledge Base context.' }),
});

export class LoadSkillFrontend extends MXTool<typeof LoadSkillFrontendParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof LoadSkillFrontendParams> = {
    name: 'LoadSkillFrontend',
    description: 'Load a user-defined skill (markdown content + description) from the active Knowledge Base context by name.',
    parameters: LoadSkillFrontendParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// Note: DeleteFile is intentionally NOT exported. There is no
// `registerFrontendTool('DeleteFile', ...)` runtime handler in
// `lib/api/tool-handlers.ts`, so advertising the tool to the LLM would
// produce "Unknown client-side tool" errors when the bridge tries to
// resolve it. If/when a DeleteFile runtime handler is added, restore the
// schema here and add it back to WebAnalystAgent.tools.
