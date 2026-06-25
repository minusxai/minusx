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
 *   - atlasSchemaNoViz — same shape with `content.properties.vizSettings`
 *                        replaced by a prose stub; embedded in the EditFile /
 *                        CreateFile tool descriptions (the full viz schema is
 *                        already documented via ExecuteQuery.vizSettings, so
 *                        repeating it wastes prompt tokens).
 *
 * Built once at module load — Ajv's `compile()` results are cached separately.
 */
import {
  QuestionContent,
  DashboardContent,
  StoryContent,
  NotebookContent,
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
  AtlasQuestionFile: toJson(AtlasQuestionFile),
  AtlasDashboardFile: toJson(AtlasDashboardFile),
  AtlasStoryFile: toJson(AtlasStoryFile),
  AtlasNotebookFile: toJson(AtlasNotebookFile),
});

// ── No-viz schema (vizSettings collapsed to a prose note) ────────────────────
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

function stripViz(fileSchema: Record<string, unknown>): Record<string, unknown> {
  const clone = toJson(fileSchema);
  stripVizDeep(clone);
  return clone;
}

export const atlasSchemaNoViz: Record<string, unknown> = topLevel({
  AtlasQuestionFile: stripViz(toJson(AtlasQuestionFile)),
  AtlasDashboardFile: stripViz(toJson(AtlasDashboardFile)),
  AtlasStoryFile: stripViz(toJson(AtlasStoryFile)),
  AtlasNotebookFile: stripViz(toJson(AtlasNotebookFile)),
});

// ── Per-file-type content schema for SKILL prompts ───────────────────────────
// Each file type's skill embeds the LIVE content schema (below) instead of a hand-typed example,
// so the prompt the LLM sees can never drift from the actual validation schema. Source of truth =
// the TypeBox `*Content` defs in atlas-schemas.ts. vizSettings is collapsed to a pointer (the full
// viz schema lives in the visualizations skill), matching the no-viz tool schema.
const CONTENT_DEF_BY_TYPE = {
  question: 'QuestionContent',
  dashboard: 'DashboardContent',
  story: 'StoryContent',
  notebook: 'NotebookContent',
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
