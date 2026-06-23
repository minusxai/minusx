import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, UserInputException, type ToolResponse } from '@/orchestrator/types';
import { getSkill } from '@/orchestrator/prompts';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
import { atlasSchemaNoViz } from '@/lib/validation/atlas-json-schemas';

// Per-file-type content JSON schema (a discriminated `oneOf` by file `type`),
// with viz stripped for token economy — vizSettings uses the ExecuteQuery
// vizSettings schema instead. Embedded into the EditFile/CreateFile descriptions
// so the model emits correctly-shaped content. Built at module load from
// the TypeBox single-source in lib/validation/atlas-schemas.ts.
const CONTENT_SCHEMA_NO_VIZ = JSON.stringify(atlasSchemaNoViz);

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

// Keep this description in sync with the EditFile behavior in tool-handlers.ts —
// the query/parameters warning in particular prevents broken queries.
const EDIT_FILE_DESCRIPTION = `Edit a file using an ordered list of string find-and-replace changes. Executes on the frontend with real Redux state.

Search for each oldMatch in the FULL file JSON and replace with newMatch.
The file JSON includes: {"id": 123, "name": "...", "path": "...", "type": "question", "content": {...}}

You can edit ANY field (name, path, or content) using this tool.

Changes are applied sequentially in order — later entries can depend on earlier ones.
All changes succeed or the batch fails: on failure the response includes \`succeededCount\`
and \`failedIndex\` so you know exactly where to retry.

On fail, you can retry with shortened oldMatch if applicable.

Example — update query and viz in one call:
EditFile(fileId=123, changes=[
    {"oldMatch": '"query":"SELECT 1"', "newMatch": '"query":"SELECT id, name FROM users"'},
    {"oldMatch": '"type":"table"', "newMatch": '"type":"bar"'}
])

CRITICAL — query + parameters must stay in sync:
If a change adds or removes :paramName tokens in the query, you MUST include a corresponding
change to the parameters array in the same call. The frontend auto-syncs on user edit, but
EditFile bypasses that — orphaned or missing parameters will cause query execution to fail.

replaceAll behaviour (per change):
- replaceAll=true (default): replace EVERY occurrence of oldMatch in the file JSON.
  Use this when renaming a column/table that appears in multiple places (SELECT, WHERE, GROUP BY, etc.).
- replaceAll=false: replace only if oldMatch is unique. If it appears more than once the
  tool returns an error — add more surrounding context to oldMatch to make it unique, or
  switch back to replaceAll=true if you really want all occurrences replaced.

Changes are staged as drafts in Redux. The user reviews and publishes all pending changes
via the Publish All button. You do not need to call Navigate or PublishFile.

String Matching: Use \`oldMatch\` copied directly from AppState content — never call ReadFiles just to get content that is already in AppState.

Notebooks: content has \`cells\` (an ordered array; each cell has a stable \`id\` and is either a \`sql\` cell — a full inline question — or a \`text\` cell). AppState content also carries \`activeCellId\`: the cell the user is currently working on. Unless they say otherwise, scope edits to that cell (match within it by its \`id\`/\`query\`), and do NOT touch other cells.

Content schema — the shape of the file's "content" field, by file type (a discriminated oneOf on "type"). For vizSettings, use the same schema as ExecuteQuery's vizSettings:
${CONTENT_SCHEMA_NO_VIZ}`;

export class EditFile extends MXTool<typeof EditFileParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof EditFileParams> = {
    name: 'EditFile',
    description: EDIT_FILE_DESCRIPTION,
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
  name: Type.String({ description: 'Name of the new file/folder. It is slugified and appended to `path` to form the full path.' }),
  // Handler treats `path` as the PARENT folder and builds `<path>/<slug(name)>`,
  // so the description must stop the LLM passing the new file's full path here.
  path: Type.String({
    description:
      'PARENT folder to create the file in (must already exist), e.g. "/org" or "/org/reports". Do NOT include the new file/folder name — it is appended automatically from `name`. To create folder "X" under /org, pass path:"/org" and name:"X" (NOT path:"/org/X").',
  }),
  // Object type (not Type.Unknown) so the model is told to send a JSON OBJECT, not
  // a stringified JSON (which previously got spread char-by-char into the content).
  // The union also accepts a string defensively — the CreateFile handler in
  // lib/api/tool-handlers.ts JSON.parses it. Shape varies by file_type, so it's an
  // open object validated per-type later by validateFileState (no discriminated union).
  content: Type.Optional(
    Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.String()], {
      description:
        'Initial content fields, merged on top of template defaults, as a JSON OBJECT (do NOT stringify). Same per-file-type content schema as EditFile — see the EditFile description for the exact shape by file type.',
    }),
  ),
  // File Architecture v2: for `questionv2` files the query/connection/viz live here
  // (a static-JSX body), NOT in `content`.
  jsx: Type.Optional(Type.String({
    description: 'For file_type "questionv2": the static-JSX body, e.g. `<Question connection="github" viz={{"type":"bar","xCols":["a"]}}>{`SELECT ...`}</Question>`. The SQL goes in a template-literal child so <, >, { stay raw. Provide this INSTEAD of content for questionv2.',
  })),
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

// ─── SetJsx / EditJsx (File Architecture v2) ─────────────────────────────────
// Operate on a file's static-JSX `jsx` body (e.g. questionv2). The body is raw
// text — edit it as such (no escaped-JSON-inside-JSON). Persisted immediately.
const JSX_FORMAT = `The jsx body is a static-JSX document. For a question it is a single <Question> element:
<Question connection="<connection_name>" viz={{ ...vizSettings... }}>{\`
SELECT ...raw SQL — <, >, { stay raw...
\`}</Question>
- connection: a plain string attribute.
- viz: a JSON object literal in {{ }} (the vizSettings — type, xCols, yCols, ...).
- The SQL goes in a template-literal child {\` ... \`} so it stays raw (escape only backtick and \${ ).
Only the <Question> component (and plain HTML) is allowed; no functions, expressions, or event handlers.`;

const SetJsxParams = Type.Object({
  fileId: Type.Number(),
  jsx: Type.String({ description: 'The full static-JSX body to set (replaces the existing jsx). Small bodies (a single question): prefer this over EditJsx.' }),
});

export class SetJsx extends MXTool<typeof SetJsxParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof SetJsxParams> = {
    name: 'SetJsx',
    description: `Replace a file's entire static-JSX body (File Architecture v2). Executes on the frontend; persisted immediately.\n\n${JSX_FORMAT}`,
    parameters: SetJsxParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

const EditJsxParams = Type.Object({
  fileId: Type.Number(),
  changes: Type.Array(Type.Object({
    oldMatch: Type.String({ description: 'Existing substring of the jsx body to replace.' }),
    newMatch: Type.String({ description: 'Replacement text.' }),
    replaceAll: Type.Optional(Type.Boolean({ description: 'Replace every occurrence (default true).' })),
  })),
});

export class EditJsx extends MXTool<typeof EditJsxParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof EditJsxParams> = {
    name: 'EditJsx',
    description: `Edit a file's static-JSX body with an ordered list of string find-and-replace changes (applied to the RAW jsx text — no escaping). Use for large bodies; for small ones prefer SetJsx. Executes on the frontend; persisted immediately.\n\n${JSX_FORMAT}`,
    parameters: EditJsxParams,
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
// images. The frontend-bridge ReadFiles behaviour means an
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
// frontend handler exactly, no spawn-wrapper needed). The server-side `Clarify`
// spawns into `ClarifyFrontend`; v2 short-circuits the spawn since the
// orchestrator dispatches by exact name.
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

// ─── LoadSkill ────────────────────────────────────────────────────────────────
// LLM-facing skill loader (matches what the skill docstrings tell the model to
// call). System skills resolve server-side from the shared prompts.yaml; unknown names are
// user-defined Knowledge Base skills, resolved on the frontend via the
// `registerFrontendTool('LoadSkill', ...)` handler in lib/api/tool-handlers.ts.
const LoadSkillParams = Type.Object({
  name: Type.String({
    description: "Skill name to load (e.g., 'alerts', 'reports', or a user-defined skill name).",
  }),
});

export class LoadSkill extends MXTool<typeof LoadSkillParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof LoadSkillParams> = {
    name: 'LoadSkill',
    description:
      'Load detailed instructions for a system or user-defined skill. ' +
      'Use `name` for both system skills and user-defined Knowledge Base skills.',
    parameters: LoadSkillParams,
  };

  async run(): Promise<ToolResponse> {
    const name = this.parameters.name;
    if (!name) {
      const error = 'LoadSkill requires a skill name';
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error }) }], isError: true };
    }
    // System skills live in the shared prompts.yaml — resolve them here.
    const content = getSkill(name);
    if (content === null) {
      // Not a system skill → user-defined; resolve on the frontend.
      throw new UserInputException(this.id);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, skill: name, content }) }],
      isError: false,
    };
  }
}

// Note: DeleteFile is intentionally NOT exported. There is no
// `registerFrontendTool('DeleteFile', ...)` runtime handler in
// `lib/api/tool-handlers.ts`, so advertising the tool to the LLM would
// produce "Unknown client-side tool" errors when the bridge tries to
// resolve it. If/when a DeleteFile runtime handler is added, restore the
// schema here and add it back to WebAnalystAgent.tools.
