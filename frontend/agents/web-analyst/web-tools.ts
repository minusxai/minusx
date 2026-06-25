import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, UserInputException, type ToolResponse } from '@/orchestrator/types';
import { getSkill } from '@/orchestrator/prompts';
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

// The agent edits the file's MARKUP (the `markup` field in AppState / ReadFiles), not JSON.
const MARKUP_FORMAT = `Every file projects to a single JSX document — that is what you edit (the \`markup\` field in AppState / ReadFiles), never escaped JSON. The content object's fields are the top-level elements (no wrapper). It is all JSX.

Rules (uniform for every file type):
- object → nested \`<field>…</field>\`; array → \`<field>\` with repeated \`<item>\` children.
- scalar → \`<field>value</field>\`. A string containing <, >, {, backtick, or a newline (e.g. SQL) rides in a RAW template-literal child: \`<query>{\`SELECT a WHERE x < 5\`}</query>\` — no escaping inside.
- a jsx field (e.g. a story's HTML body) is emitted INLINE as real elements, with \`<Question/>\` embeds. \`<Question/>\` is polymorphic: \`<Question id={5}/>\` embeds a SAVED question (preferred — reuse one when it fits); \`<Question query={\`SELECT …\`} connection="…" viz={{type:"single_value", yCols:["mrr"], singleValueConfig:{prefix:"$"}}} height="200px"/>\` embeds an INLINE story-local question whose query lives in the body (use for one-off live numbers). The query MUST be a backtick template literal with real newlines — never a quoted string or \\n escapes. NUMBERS shown to the reader must be LIVE embeds, never typed into the prose. For a number that sits INLINE IN A SENTENCE (not a chart card), use \`<Number/>\` — a live figure in a \`<span>\`: \`<Number id={142} prefix="$" />\` (reads from saved question 142) or \`<Number query={\`SELECT SUM(mrr) AS mrr FROM metrics\`} connection="duckdb" col="mrr" prefix="$" suffix=" MRR" />\` (inline). Optional \`col\` picks the column (else the first), \`prefix\`/\`suffix\` wrap it, \`style={{…}}\` themes the span (e.g. \`style={{color:"#c8781a", fontWeight:700}}\`); clicking it reveals the source question as a footnote. Use \`<Number/>\` for "MRR grew to $X" prose; use \`<Question viz={{type:"single_value"}}/>\` for a big hero number in its own card. A story can also declare shared filters with \`<Param name="city" type="text" nullable={false} id={5} />\` — every embedded question's matching \`:param\` binds to it (\`id={N}\` autocompletes/imports from question N's column). Style the filter to match the story with \`style={{…}}\` (the input) and \`labelStyle={{…}}\` (the label) — LITERAL CSS objects (e.g. \`style={{background:"#1a1a1a", color:"#fff", borderColor:"#444"}}\`), not theme tokens. For a NUMBER param you can swap the input for a range slider: \`<Param name="limit" type="number" widget="slider" min={0} max={100} step={5} />\`. Both inline \`<Question>\` AND inline \`<Number>\` queries bind these \`:param\` values automatically (a \`<Number query={\`… WHERE mrr >= :min_mrr\`}>\` reacts live to a \`min_mrr\` slider), and the story's \`parameterValues\` are their defaults. If an embedded question/number uses a \`:param\` with no \`<Param>\`, you'll get a validation warning (non-blocking).
- config types with no schema (connection/config/context/…) annotate non-string scalars so they round-trip: \`<port type="number">5432</port>\`, \`<enabled type="boolean">true</enabled>\`.

Example question markup:
<description>Revenue by month</description>
<query>{\`SELECT month, SUM(revenue) AS rev FROM sales WHERE rev < 5000 GROUP BY 1\`}</query>
<vizSettings>
  <type>bar</type>
  <xCols><item>month</item></xCols>
  <yCols><item>rev</item></yCols>
</vizSettings>
<connection_name>saas_metrics</connection_name>`;

// Keep this description in sync with the EditFile behavior in tool-handlers.ts —
// the query/parameters warning in particular prevents broken queries.
const EDIT_FILE_DESCRIPTION = `Edit a file using an ordered list of string find-and-replace changes over its MARKUP. Executes on the frontend with real Redux state.

${MARKUP_FORMAT}

Search for each oldMatch in the file's markup and replace with newMatch. Because the markup is clean text (raw SQL, no JSON-in-JSON escaping), oldMatch is usually a short literal substring — e.g. the changed SQL fragment.

Changes are applied sequentially in order — later entries can depend on earlier ones.
All changes succeed or the batch fails: on failure the response includes \`succeededCount\`
and \`failedIndex\` so you know exactly where to retry. On fail, retry with a shortened/uniquer oldMatch.

Example — change the SQL ordering and the viz type in one call:
EditFile(fileId=123, changes=[
    {"oldMatch": 'GROUP BY 1 ORDER BY 1', "newMatch": 'GROUP BY 1 ORDER BY 2 DESC'},
    {"oldMatch": '<type>table</type>', "newMatch": '<type>bar</type>'}
])

CRITICAL — query + parameters must stay in sync:
If a change adds or removes :paramName tokens in the query, you MUST include a corresponding
change to the \`<parameters>\` in the same call — orphaned or missing parameters fail execution.

replaceAll behaviour (per change):
- replaceAll=true (default): replace EVERY occurrence (use when renaming a column/table that appears in SELECT, WHERE, GROUP BY, …).
- replaceAll=false: replace only if oldMatch is unique; otherwise the tool errors — add surrounding context to make it unique.

Changes are staged as drafts in Redux. The user reviews and publishes via Publish All. You do not need to call Navigate or PublishFile.

String Matching: copy \`oldMatch\` directly from the \`markup\` in AppState — never call ReadFiles just to get markup already in AppState.

Notebooks: the markup has a \`<cells>\` element (ordered; each cell has a stable \`<id>\` and is a \`sql\` or \`text\` cell). AppState also carries \`activeCellId\` — scope edits to that cell unless told otherwise.`;

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
  // File Architecture v2: the new file's body is authored as MARKUP — the same shape
  // EditFile edits and ReadFiles returns (see the EditFile description / MARKUP_FORMAT).
  markup: Type.Optional(Type.String({
    description:
      "The new file's content as MARKUP (preferred) — one JSX document, the content fields as top-level elements (objects nest, arrays use <item>, SQL/raw strings in a {`…`} child, a story's HTML body inline with <Question id={N}/> embeds). See the EditFile description for the exact shape and examples.",
  })),
  // Optional structured fallback: initial content fields merged over template defaults, as a
  // JSON OBJECT. Prefer `markup`. (A string is JSON.parsed defensively by the handler.)
  content: Type.Optional(
    Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.String()], {
      description: 'Initial content fields as a JSON OBJECT, merged over template defaults. Prefer `markup`.',
    }),
  ),
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

// SetJsx / EditJsx were removed in File Architecture v2 — the agent edits a document's
// jsx body through EditFile (the markup's <jsx> block), same as any other file.

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
    description: "Load one or more files by integer ID with their references and (optionally) executed query results. Reads in-flight Redux state including unpublished drafts. Each file's `markup` field is its editable surface (the same markup EditFile operates on) — prefer it over the raw `content`.",
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
