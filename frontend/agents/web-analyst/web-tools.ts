import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, UserInputException, type ToolResponse } from '@/orchestrator/types';
import { loadSkill } from '@/agents/skill-content';
import type { RemoteAnalystContext } from '@/agents/analyst/types';

// LoadContext soft over-fetch nudge: if the agent requests at least this many docs
// in a single call, return them but warn it to be more selective. Absolute (not a
// fraction of the library) since contexts often start with only 1-2 docs.
const LOAD_CONTEXT_MAX_KEYS_BEFORE_WARNING = 5;
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
  rawData: Type.Optional(Type.Boolean({ description: "Default false. The response echoes the updated query RESULT (not the markup — you already know your edit): a chart viz returns an IMAGE + summary, a table/number viz returns the rows + summary. Set true to get rows even for a chart viz." })),
});

// The agent edits the file's MARKUP (the raw `<file_markup>` block in AppState / ReadFiles), not JSON.
const MARKUP_FORMAT = `Every file projects to a single JSX document — that is what you edit. It is delivered as a raw \`<file_markup file_id=…>\` block printed after the AppState / ReadFiles / CreateFile / EditFile JSON (real JSX, never an escaped JSON string value). The content object's fields are the top-level elements (no wrapper). It is all JSX.

Rules (uniform for every file type):
- object → nested \`<field>…</field>\`; array → \`<field>\` with repeated \`<item>\` children.
- scalar → \`<field>value</field>\`. A string containing <, >, {, backtick, or a newline (e.g. SQL) rides in a RAW template-literal child: \`<query>{\`SELECT a WHERE x < 5\`}</query>\` — no escaping inside.
- a \`jsx\` field (e.g. a data story's body) is emitted INLINE as real JSX elements (never an escaped string); its embeds/components (e.g. data stories' \`<Question>\`/\`<Number>\`/\`<Param>\`) are documented in that file type's skill.
- config types with no schema (connection/config/context/…) annotate non-string scalars so they round-trip: \`<port type="number">5432</port>\`, \`<enabled type="boolean">true</enabled>\`.

The exact fields (and any embeds) for each file type are defined in that type's skill — questions, dashboards, reports, alerts, data_stories, notebooks — the single source of truth for its markup. Load/consult the relevant skill before authoring; never invent fields.`;

// Keep this description in sync with the EditFile behavior in tool-handlers.ts —
// the query/parameters warning in particular prevents broken queries.
const EDIT_FILE_DESCRIPTION = `Edit a file using an ordered list of string find-and-replace changes over its MARKUP. Executes on the frontend with real Redux state.

${MARKUP_FORMAT}

Search for each oldMatch in the file's markup and replace with newMatch. Because the markup is clean text (raw SQL, no JSON-in-JSON escaping), oldMatch is usually a short literal substring — e.g. the changed SQL fragment.

Changes are applied sequentially in order — later entries can depend on earlier ones.
All changes succeed or the batch fails: on failure the response includes \`succeededCount\`
and \`failedIndex\` so you know exactly where to retry. On fail, retry with a shortened/uniquer oldMatch.

CRITICAL — query + parameters must stay in sync:
If a change adds or removes :paramName tokens in the query, you MUST include a corresponding
change to the \`<parameters>\` in the same call — orphaned or missing parameters fail execution.

replaceAll behaviour (per change):
- replaceAll=true (default): replace EVERY occurrence (use when renaming a column/table that appears in SELECT, WHERE, GROUP BY, …).
- replaceAll=false: replace only if oldMatch is unique; otherwise the tool errors — add surrounding context to make it unique.

Changes are staged as drafts in Redux. The user reviews and publishes via Publish All. You do not need to call Navigate or PublishFile.

String Matching: copy \`oldMatch\` directly from the \`markup\` in AppState — never call ReadFiles just to get markup already in AppState.`;

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

// ─── Screenshot ──────────────────────────────────────────────────────────────
// Schema matches `registerFrontendTool('Screenshot', ...)`. Frontend-only: it
// captures the LIVE rendered DOM (html-to-image) of the file currently open in the
// browser, so it can't run headless (no DOM).
const ScreenshotParams = Type.Object({
  fileId: Type.Number({ description: 'ID of the file to screenshot — must be the file currently open in the browser (its rendered view is captured).' }),
  fullHeight: Type.Optional(Type.Boolean({ description: 'Capture the full scrolled height including off-screen content (default false — visible area only).' })),
});

export class Screenshot extends MXTool<typeof ScreenshotParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof ScreenshotParams> = {
    name: 'Screenshot',
    description: 'See a rendered screenshot of the current file (question/dashboard/story/notebook/report) as an image. Use after authoring visual content — especially a data story, report, or notebook — to verify the layout, styling, and embeds render as intended before telling the user it is done.',
    parameters: ScreenshotParams,
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
    const content = loadSkill(name);
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

// ─── LoadContext ────────────────────────────────────────────────────────────────
// Lazily load full context-doc content. The system prompt advertises a "Context
// Library" catalog of doc keys + descriptions (via resolveContextDocs); each key
// is the stable identifier the agent passes here. This tool resolves the requested
// keys' full content from the server-resolved library on the agent context. Pure
// server tool — never throws UserInputException.
const LoadContextParams = Type.Object({
  keys: Type.Array(Type.String(), {
    description: 'Document keys from the Context Library (the quoted identifier shown for each doc) to load full content for. Request only the docs relevant to the current question.',
  }),
});

export class LoadContext extends MXTool<typeof LoadContextParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof LoadContextParams> = {
    name: 'LoadContext',
    description:
      'Load the full content of one or more context documents by their key, as listed in the Context Library. ' +
      'Request only the specific docs relevant to the user\'s question or app state — avoid loading everything at once.',
    parameters: LoadContextParams,
  };

  async run(): Promise<ToolResponse> {
    const library = this.context.contextDocsLibrary ?? [];
    const keys = this.parameters.keys ?? [];

    if (keys.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'LoadContext requires at least one document key' }) }],
        isError: true,
      };
    }
    if (library.length === 0) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No context documents are available to load' }) }],
        isError: true,
      };
    }

    const byKey = new Map(library.map((d) => [d.key, d]));
    // Fallback: also resolve by (case-insensitive) title, in case the agent passes
    // the human title instead of the key. Keys are always unique, but titles need
    // not be — so only resolve titles that uniquely identify one doc.
    const titleCounts = new Map<string, number>();
    for (const d of library) {
      const t = d.title.trim().toLowerCase();
      titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
    }
    const byTitle = new Map(
      library
        .filter((d) => titleCounts.get(d.title.trim().toLowerCase()) === 1)
        .map((d) => [d.title.trim().toLowerCase(), d]),
    );
    const docs: { key: string; title: string; content: string }[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = byKey.get(key) ?? byTitle.get(key.trim().toLowerCase());
      if (entry) docs.push({ key: entry.key, title: entry.title, content: entry.content });
      else missing.push(key);
    }

    // Soft over-fetch nudge: discourage pulling all/most docs in a single call.
    const payload: {
      success: boolean;
      docs: { key: string; title: string; content: string }[];
      missing?: string[];
      warning?: string;
    } = { success: true, docs };
    if (missing.length > 0) payload.missing = missing;
    if (docs.length >= LOAD_CONTEXT_MAX_KEYS_BEFORE_WARNING) {
      payload.warning =
        `You loaded ${docs.length} documents at once. In future, load only the docs relevant to the user's question.`;
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
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
