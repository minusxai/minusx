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

function stripViz(fileSchema: Record<string, unknown>): Record<string, unknown> {
  const clone = toJson(fileSchema);
  const content = (clone.properties as Record<string, Record<string, unknown>>)?.content;
  const contentProps = content?.properties as Record<string, unknown> | undefined;
  if (contentProps && 'vizSettings' in contentProps) {
    contentProps.vizSettings = VIZ_NOTE;
  }
  return clone;
}

export const atlasSchemaNoViz: Record<string, unknown> = topLevel({
  AtlasQuestionFile: stripViz(toJson(AtlasQuestionFile)),
  AtlasDashboardFile: stripViz(toJson(AtlasDashboardFile)),
  AtlasStoryFile: stripViz(toJson(AtlasStoryFile)),
  AtlasNotebookFile: stripViz(toJson(AtlasNotebookFile)),
});
