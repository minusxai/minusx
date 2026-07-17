/**
 * Atlas JSON-Schema artifacts, built at runtime from the TypeBox single-source
 * in `atlas-schemas.ts`. Replaces the previous codegen (`generate-atlas-schema.ts`
 * + checked-in `*.gen.json` files), which existed back when a separate Python
 * backend needed the schemas as JSON files. Now both consumers are in-process
 * TypeScript, so there's no reason to round-trip through disk.
 *
 * Exports:
 *   - atlasSchema      — full discriminated `oneOf` schema; consumed by Ajv in
 *                        `content-validators.ts`.
 *
 * Built once at module load — Ajv's `compile()` results are cached separately.
 */
import {
  QuestionContent,
  DashboardContent,
  StoryContent,
  NotebookContent,
  ContextAgentContent,
  AtlasQuestionFile,
  AtlasDashboardFile,
  AtlasStoryFile,
  AtlasNotebookFile,
} from './atlas-schemas';

/** Deep-clone to plain JSON, dropping TypeBox's Symbol-keyed metadata. */
const toJson = (schema: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

const topLevel = (defs: Record<string, unknown>): Record<string, unknown> => ({
  $defs: defs,
  discriminator: { propertyName: 'type' },
  oneOf: [
    { $ref: '#/$defs/AtlasQuestionFile' },
    { $ref: '#/$defs/AtlasDashboardFile' },
    { $ref: '#/$defs/AtlasStoryFile' },
    { $ref: '#/$defs/AtlasNotebookFile' },
  ],
});

// ── Full schema (with viz) ───────────────────────────────────────────────────
export const atlasSchema: Record<string, unknown> = topLevel({
  QuestionContent: toJson(QuestionContent),
  DashboardContent: toJson(DashboardContent),
  StoryContent: toJson(StoryContent),
  NotebookContent: toJson(NotebookContent),
  // Agent's flattened context view — used for the schema_context skill var + context markup
  // ($ref resolution in file-markup). NOT a member of the validation `oneOf`: contexts persist
  // version-based and aren't validated against this flat view (see content-validators.ts).
  ContextContent: toJson(ContextAgentContent),
  AtlasQuestionFile: toJson(AtlasQuestionFile),
  AtlasDashboardFile: toJson(AtlasDashboardFile),
  AtlasStoryFile: toJson(AtlasStoryFile),
  AtlasNotebookFile: toJson(AtlasNotebookFile),
});

// ── vizSettings stripping (used for per-file-type SKILL prompt schemas) ──────
const VIZ_NOTE = {
  type: 'object',
  description: 'vizSettings — see ExecuteQuery.vizSettings for schema',
};

/**
 * Recursively replace every `vizSettings` schema with the prose stub and drop
 * every `cellResults` schema. Walks the whole tree because notebooks embed a
 * full `vizSettings` inside *each* SQL cell (`content.cells[].vizSettings`),
 * not just at `content.vizSettings` like questions — a top-level-only strip
 * would leave the full viz schema (e.g. `ChoroplethConfig`) in notebook cells.
 */
function stripVizDeep(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripVizDeep(item);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const props = obj.properties as Record<string, unknown> | undefined;
  if (props) {
    if ('vizSettings' in props) props.vizSettings = { ...VIZ_NOTE };
    // cellResults are system-managed cached results — never authored by the
    // agent, so drop them from the EditFile/CreateFile schema description.
    if ('cellResults' in props) delete props.cellResults;
  }
  for (const value of Object.values(obj)) stripVizDeep(value);
}

// ── Per-file-type content schema for SKILL prompts ───────────────────────────
// Each file type's skill embeds the LIVE content schema (below) instead of a hand-typed example,
// so the prompt the LLM sees can never drift from the actual validation schema. Source of truth =
// the TypeBox `*Content` defs in atlas-schemas.ts. vizSettings is collapsed to a pointer (the
// legacy viz schema is deliberately undocumented — agents author `<viz>` envelopes, taught in the
// questions skill), matching the no-viz tool schema.
const CONTENT_DEF_BY_TYPE = {
  question: 'QuestionContent',
  dashboard: 'DashboardContent',
  story: 'StoryContent',
  notebook: 'NotebookContent',
  context: 'ContextContent',
} as const;

export type AtlasSchemaFileType = keyof typeof CONTENT_DEF_BY_TYPE;
export const ATLAS_SCHEMA_FILE_TYPES = Object.keys(CONTENT_DEF_BY_TYPE) as AtlasSchemaFileType[];

/** The LIVE, viz-collapsed JSON-Schema for a file type's editable content, pretty-printed. */
export function contentSchemaText(fileType: AtlasSchemaFileType): string {
  const defs = atlasSchema.$defs as Record<string, unknown>;
  const def = defs[CONTENT_DEF_BY_TYPE[fileType]];
  if (!def) throw new Error(`No Atlas content schema for file type '${fileType}'`);
  const clone = toJson(def);
  stripVizDeep(clone); // collapse vizSettings → pointer, drop system-managed cellResults
  return JSON.stringify(clone, null, 2);
}

/** `schema_question` … → rendered schema. Merged into the prompt template tree so skills can
 *  reference `{schema_question}` etc. (see orchestrator/prompts/index.ts). */
export const SCHEMA_TEMPLATE_VARS: Record<string, string> = Object.fromEntries(
  ATLAS_SCHEMA_FILE_TYPES.map((t) => [`schema_${t}`, contentSchemaText(t)]),
);
