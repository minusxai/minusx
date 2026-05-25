/**
 * Generate the Atlas JSON-Schema artifacts from the TypeBox single-source in
 * `lib/validation/atlas-schemas.ts`. Run via `npm run generate-types`.
 *
 * Emits:
 *   - lib/validation/atlas-schema.gen.json        (full; consumed by Ajv in content-validators.ts)
 *   - lib/validation/atlas-schema-no-viz.gen.json (viz stripped; embedded in the EditFile tool description)
 *
 * The schemas are inlined (no cross-$defs $refs) — the only $defs that need to
 * resolve are the ones consumers reference: `QuestionContent` / `DashboardContent`
 * (Ajv) and `AtlasQuestionFile` / `AtlasDashboardFile` (the EditFile embed).
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  QuestionContent,
  DashboardContent,
  AtlasQuestionFile,
  AtlasDashboardFile,
} from '../lib/validation/atlas-schemas';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'validation');

/** Deep-clone to plain JSON, dropping TypeBox's Symbol-keyed metadata. */
const toJson = (schema: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

const topLevel = (defs: Record<string, unknown>) => ({
  $defs: defs,
  discriminator: { propertyName: 'type' },
  oneOf: [
    { $ref: '#/$defs/AtlasQuestionFile' },
    { $ref: '#/$defs/AtlasDashboardFile' },
  ],
});

// ── Full schema (with viz) ───────────────────────────────────────────────────
const fullSchema = topLevel({
  QuestionContent: toJson(QuestionContent),
  DashboardContent: toJson(DashboardContent),
  AtlasQuestionFile: toJson(AtlasQuestionFile),
  AtlasDashboardFile: toJson(AtlasDashboardFile),
});

// ── No-viz schema (vizSettings collapsed to a prose note) ─────────────────────
// The full VisualizationSettings schema is already documented via
// ExecuteQuery.vizSettings; embedding it again in EditFile wastes prompt tokens.
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

const noVizSchema = topLevel({
  AtlasQuestionFile: stripViz(toJson(AtlasQuestionFile)),
  AtlasDashboardFile: stripViz(toJson(AtlasDashboardFile)),
});

writeFileSync(join(OUT_DIR, 'atlas-schema.gen.json'), JSON.stringify(fullSchema, null, 2) + '\n');
writeFileSync(join(OUT_DIR, 'atlas-schema-no-viz.gen.json'), JSON.stringify(noVizSchema, null, 2) + '\n');

console.log('[generate-atlas-schema] wrote atlas-schema.gen.json + atlas-schema-no-viz.gen.json');
