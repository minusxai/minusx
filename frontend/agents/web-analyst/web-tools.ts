import { Type } from 'typebox';
import type { Tool } from '@/orchestrator/llm';
import { MXTool, UserInputException, type ToolResponse } from '@/orchestrator/types';
import { loadSkill, listSystemSkillNames } from '@/agents/skill-content';
import { loadContextDocsByKeys } from '@/lib/sql/context-docs';
import type { RemoteAnalystContext } from '@/agents/analyst/types';
// All tools below execute in the browser via the existing
// `executeToolCall` registry (lib/tools/tool-handlers.ts). Server-side they
// throw UserInputException so the orchestrator pauses; the bridge (Redux
// listener middleware) calls `executeToolCall(...)` for real and resumes the
// orchestrator with the resulting ToolResultMessage. The Node side is a thin
// declaration — no logic, no reimplementation.

// ─── EditFile ────────────────────────────────────────────────────────────────
// Schema MUST match the runtime handler in `lib/tools/tool-handlers.ts`
// (`registerFrontendTool('EditFile', ...)`) — the dual-update rule. The
// handler expects `changes: [{oldMatch, newMatch, replaceAll?}]`.
const EditFileParams = Type.Object({
  fileId: Type.Number(),
  name: Type.Optional(Type.String({ description: "Set or rename the file's TITLE (its `name` metadata). The title is NOT part of the markup, so this `name` field is the ONLY way to title a file — always give questions/dashboards/etc. a short, descriptive title. Can be used alone (rename only) or alongside `changes`." })),
  changes: Type.Optional(Type.Array(Type.Object({
    oldMatch: Type.String({ description: 'Existing substring to replace.' }),
    newMatch: Type.String({ description: 'Replacement text.' }),
    replaceAll: Type.Optional(Type.Boolean({ description: 'Replace every occurrence (default true).' })),
  }), { description: 'Markup find-and-replace edits. Optional — omit (or pass []) for a rename-only edit that just sets `name`.' })),
  rawData: Type.Optional(Type.Boolean({ description: "Default false. The response echoes the updated query RESULT (not the markup — you already know your edit): a chart viz returns an IMAGE + summary, a table/number viz returns the rows + summary. Set true to get rows even for a chart viz." })),
  review: Type.Optional(Type.Boolean({ description: 'Default true: the response includes the FULL post-edit review (screenshot of the rendered result + rules + LLM visual judge + score) — this takes a few seconds. Set false to skip it on INTERMEDIATE edits of a planned batch (the fast rules-based rubric is still attached); keep it on (default) for the last edit of a batch so you see the real grade.' })),
});

// The agent edits the file's MARKUP (the raw `<file_markup>` block in AppState / ReadFiles), not JSON.
const MARKUP_FORMAT = `Every file projects to a single JSX document — that is what you edit. It is delivered as a raw \`<file_markup file_id=…>\` block printed after the AppState / ReadFiles / CreateFile / EditFile JSON (real JSX, never an escaped JSON string value). The content object's fields are the top-level elements (no wrapper). It is all JSX.

Rules (uniform for every file type):
- object → nested \`<field>…</field>\`; array → \`<field>\` with repeated \`<item>\` children.
- scalar → \`<field>value</field>\`. A string containing <, >, {, backtick, or a newline (e.g. SQL) rides in a RAW template-literal child: \`<query>{\`SELECT a WHERE x < 5\`}</query>\` — no escaping inside.
- a \`jsx\` field (e.g. a story's body) is emitted INLINE as real JSX elements (never an escaped string); its embeds/components (e.g. stories' \`<Question>\`/\`<Number>\`/\`<Param>\`) are documented in that file type's skill.
- config types with no schema (connection/config/context/…) annotate non-string scalars so they round-trip: \`<port type="number">5432</port>\`, \`<enabled type="boolean">true</enabled>\`.

The exact fields (and any embeds) for each file type are defined in that type's skill — questions, dashboards, reports, alerts, stories, notebooks — the single source of truth for its markup. Load/consult the relevant skill before authoring; never invent fields.`;

// Keep this description in sync with the EditFile behavior in tool-handlers.ts —
// the query/parameters warning in particular prevents broken queries.
const EDIT_FILE_DESCRIPTION = `Edit a file using an ordered list of string find-and-replace changes over its MARKUP. Executes on the frontend with real Redux state.

${MARKUP_FORMAT}

Search for each oldMatch in the file's markup and replace with newMatch. Because the markup is clean text (raw SQL, no JSON-in-JSON escaping), oldMatch is usually a short literal substring — e.g. the changed SQL fragment.

Changes are applied sequentially in order — later entries can depend on earlier ones.
All changes succeed or the batch fails ATOMICALLY: on failure nothing was applied, and the
response includes \`failedIndex\` plus \`currentMarkup\` — the file's CURRENT markup. A match
failure usually means your view is stale (a previous EditFile this turn already changed the
file), so rebuild \`oldMatch\` from \`currentMarkup\` and retry — never retry the same
\`oldMatch\` verbatim, and never guess.

PRE-EXISTING broken markup: if the edit fails because the file's EXISTING markup is already
invalid (a parse/validation error you did not introduce — a malformed header block, an
unclosed element, a stray brace), do NOT stop to ask permission. Repair and proceed in one
flow: (1) locate the corruption in \`currentMarkup\`; (2) apply the SMALLEST repair that makes
the markup valid again while preserving all existing content — fix the broken tag or brace,
never delete whole sections just to silence the error; (3) apply the originally requested
edit; (4) tell the user afterward what you repaired, in one line. Only pause to ask first
when no repair is possible without deleting or rewriting substantial user content —
ambiguity about CONTENT is the user's call; mechanical structure is yours to fix.

CRITICAL — query + parameters must stay in sync:
If a change adds or removes :paramName tokens in the query, you MUST include a corresponding
change to the \`<parameters>\` in the same call — orphaned or missing parameters fail execution.

replaceAll behaviour (per change):
- replaceAll=true (default): replace EVERY occurrence (use when renaming a column/table that appears in SELECT, WHERE, GROUP BY, …).
- replaceAll=false: replace only if oldMatch is unique; otherwise the tool errors — add surrounding context to make it unique.

TITLE: a file's title is its \`name\` metadata, NOT part of the markup. To title or rename a file, pass the \`name\` field (it can be the only thing you pass — a rename needs no \`changes\`). Always give a new file a short, descriptive title.

Changes are staged as drafts in Redux. The user reviews and publishes via Publish All. You do not need to call Navigate or PublishFile.

String Matching: copy \`oldMatch\` directly from the freshest markup you have: the \`markup\` in AppState, or — after any EditFile this turn — the file as YOUR EDITS left it (AppState markup is a snapshot from the start of the turn; it does NOT refresh between tool calls). After a failed edit, rebuild from the error's \`currentMarkup\`. Never call ReadFiles just to get markup already in AppState.`;

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
// `lib/tools/tool-handlers.ts`. Handler reads `file_type`, `name`, `path`, `content`.
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

// ─── DetachViz ───────────────────────────────────────────────────────────────
// Schema MUST match `registerFrontendTool('DetachViz', ...)` in tool-handlers.ts.
const DetachVizParams = Type.Object({
  fileId: Type.Number({ description: 'The question file whose recipe chart to detach.' }),
});

const DETACH_VIZ_DESCRIPTION = `Detach a question's RECIPE chart into its FULL editable spec, so you can then customize ANYTHING the recipe's params/bindings can't express — a specific mark color, dashed strokes, an extra layer, a per-point label, a custom scale, moving the legend inside the plot.

WHEN TO USE — only as the escape hatch, after params/bindings can't do it:
1. If a recipe PARAM expresses the ask (colorScale, markColor, mapName, center/zoom, basemap, barOpacity…) → just EditFile the param. Do NOT detach.
2. If a BINDING expresses it (add a size column for bubbles, destination coords for flows) → rebind. Do NOT detach.
3. Only if NEITHER can → DetachViz, then EditFile the spec.
Detaching turns the chart into a \`custom\` viz: it drops the friendly param controls AND future recipe upgrades (until re-attached), so prefer params whenever one fits.

HOW IT WORKS: native-engine recipes (radar/trend/single-value/choropleth/point-map) detach to a native Vega spec (\`kind: 'vega'\`); Vega-Lite recipes (funnel/waterfall/combo) to \`kind: 'vega-lite'\`. The response returns the file's CURRENT markup with the full spec inlined — build your EditFile \`oldMatch\` from that \`currentMarkup\` (the app-state markup is now stale). The original recipe is kept in \`detachedFrom\`, so it's REVERSIBLE ("Reset to recipe"). No-op if the chart is already a raw spec or not a recipe.`;

export class DetachViz extends MXTool<typeof DetachVizParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof DetachVizParams> = {
    name: 'DetachViz',
    description: DETACH_VIZ_DESCRIPTION,
    parameters: DetachVizParams,
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
  rawData: Type.Optional(Type.Boolean({ description: 'Default false: a question with a CHART viz returns its result as an IMAGE + summary and the row data is dropped. Set true to ALSO get the actual rows — use this whenever you need real values from a chart question (e.g. picking a number for a claim or a <Number> embed, checking sort order) instead of eyeballing the image.' })),
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

// ─── ReviewFile ──────────────────────────────────────────────────────────────
// Schema matches `registerFrontendTool('ReviewFile', ...)`. Frontend-only: it
// captures the LIVE rendered DOM (html-to-image) of the file currently open in the
// browser, so it can't run headless (no DOM).
const ReviewFileParams = Type.Object({
  fileId: Type.Number({ description: 'ID of the file to review — must be the file currently open in the browser (its rendered view is captured).' }),
  fullHeight: Type.Optional(Type.Boolean({ description: 'Capture the full scrolled height including off-screen content (default true).' })),
});

export class ReviewFile extends MXTool<typeof ReviewFileParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof ReviewFileParams> = {
    name: 'ReviewFile',
    description: 'Review the current file WITHOUT editing it: returns a rendered screenshot plus the full health rubric — deterministic errors/warnings, the LLM visual judge, and the score (the same review EditFile returns after a change). ALWAYS fix `error` findings (any error gates the score to 0); try to fix `warn` findings. Use after authoring visual content — especially a story, report, or dashboard — to verify layout, styling, and embeds before telling the user it is done.',
    parameters: ReviewFileParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// LEGACY: replaced by ReviewFile. Kept registered (REGISTRABLES + frontend handler alias) so
// saved conversation logs with Screenshot calls still resume; NOT in any agent's toolset.
export class Screenshot extends MXTool<typeof ReviewFileParams, RemoteAnalystContext> {
  static readonly schema: Tool<typeof ReviewFileParams> = {
    name: 'Screenshot',
    description: 'Legacy alias of ReviewFile.',
    parameters: ReviewFileParams,
  };

  async run(): Promise<ToolResponse> {
    throw new UserInputException(this.id);
  }
}

// ─── ClarifyFrontend ─────────────────────────────────────────────────────────
// Schema matches `registerFrontendTool('ClarifyFrontend', ...)` at line 382 —
// handler reads `question`, `options[{label, description?, value?, imageUrl?}]`, `multiSelect?`,
// and the optional `type` preset ('design' → app-supplied theme options).
// Naming: we expose the LLM-visible name as `ClarifyFrontend` (matches the
// frontend handler exactly, no spawn-wrapper needed). The server-side `Clarify`
// spawns into `ClarifyFrontend`; v2 short-circuits the spawn since the
// orchestrator dispatches by exact name.
const ClarifyFrontendParams = Type.Object({
  question: Type.String({ description: 'Question to ask the user.' }),
  options: Type.Array(Type.Object({
    label: Type.String({ description: 'Short label shown on the option button.' }),
    description: Type.Optional(Type.String({ description: 'Longer description shown beneath the label.' })),
    value: Type.Optional(Type.String({ description: 'Machine value returned when this option is picked (defaults to the label).' })),
    imageUrl: Type.Optional(Type.String({ description: 'Preview image URL — when present, options render as image cards.' })),
  }), { description: "Multiple-choice options the user can select from. Ignored for preset `type`s (pass [])." }),
  multiSelect: Type.Optional(Type.Boolean({ description: 'Allow selecting more than one option (default false).' })),
  type: Type.Optional(Type.Union([Type.Literal('design'), Type.Literal('template')], {
    description: "Preset picker — the app supplies the options (with preview images) itself; pass `options: []`. The result returns the chosen value PLUS its authoring guidance. 'design': the six story design themes (tokens/fonts/personality). 'template': the story templates (structural genre: editorial | deck | scrolly).",
  })),
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
    description: 'Open the Publish modal for the user to review and commit all unsaved file changes. Call ONLY when (a) the user explicitly asks to save/publish, or (b) you are about to Navigate away from a file with unsaved edits — then tell the user why you are publishing first. NEVER call it as any other task\'s follow-up: edits stay staged as drafts for the user to review and publish themselves.',
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
// `registerFrontendTool('LoadSkill', ...)` handler in lib/tools/tool-handlers.ts.
const LoadSkillParams = Type.Object({
  name: Type.String({
    // Enumerate the REAL names — agents were guessing ('story', 'writing_stories') and burning
    // retries; the list is derived live from prompts.yaml so it can't drift.
    description: `Skill name to load. System skills: ${listSystemSkillNames().map((n) => `'${n}'`).join(', ')}. User-defined Knowledge Base skill names also work.`,
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
      // Not a system skill. Bridge to the frontend ONLY when the name matches a user-defined
      // Knowledge Base skill (the browser resolves its content). A name that matches NEITHER is a
      // guess — fail fast WITH the valid names so the agent self-corrects in one step, instead of
      // a wasted browser round-trip ending in an unhelpful "not found".
      const userSkillNames = (this.context.userSkillCatalog ?? []).map((sk) => sk.name);
      if (!userSkillNames.includes(name)) {
        const error = `Unknown skill '${name}'. System skills: ${listSystemSkillNames().map((n) => `'${n}'`).join(', ')}`
          + (userSkillNames.length > 0 ? `. User skills: ${userSkillNames.map((n) => `'${n}'`).join(', ')}` : '')
          + '.';
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error }) }], isError: true };
      }
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
    // Shared resolver — same key/title resolution + over-fetch nudge the MCP
    // LoadContext tool uses (see lib/mcp/server.ts).
    const { payload, isError } = loadContextDocsByKeys(this.context.resolvedContextDocs, this.parameters.keys ?? []);
    return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError };
  }
}

// Note: DeleteFile is intentionally NOT exported. There is no
// `registerFrontendTool('DeleteFile', ...)` runtime handler in
// `lib/tools/tool-handlers.ts`, so advertising the tool to the LLM would
// produce "Unknown client-side tool" errors when the bridge tries to
// resolve it. If/when a DeleteFile runtime handler is added, restore the
// schema here and add it back to WebAnalystAgent.tools.
