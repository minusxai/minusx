/**
 * Runtime validators for Atlas file content.
 * Compiled from the in-process JSON schema (lib/validation/atlas-json-schemas.ts),
 * which is built at module load from the TypeBox source.
 */
import Ajv from 'ajv';
import { atlasSchema } from './atlas-json-schemas';
import type { FileType, QuestionContent, DashboardContent, StoryContent, NotebookContent, QuestionV2Content } from '@/lib/types';
import { validateOrgConfig } from '@/lib/validation/config-validators';

// `verbose` so each error carries the received `data` — needed to report
// expected-vs-got in formatErrors() below.
const ajv = new Ajv({ allErrors: true, verbose: true });
ajv.addSchema(atlasSchema, 'atlas');

// Validators compiled once at module load — not per-call
const validators: Record<string, Ajv.ValidateFunction> = {
  QuestionContent: ajv.compile({ $ref: 'atlas#/$defs/QuestionContent' }),
  DashboardContent: ajv.compile({ $ref: 'atlas#/$defs/DashboardContent' }),
  StoryContent: ajv.compile({ $ref: 'atlas#/$defs/StoryContent' }),
  NotebookContent: ajv.compile({ $ref: 'atlas#/$defs/NotebookContent' }),
  QuestionV2Content: ajv.compile({ $ref: 'atlas#/$defs/QuestionV2Content' }),
};

/** Short, human/LLM-readable description of a received value (type + a snippet). */
function describeValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'object') {
    const s = JSON.stringify(v);
    return `object ${s.length > 60 ? s.slice(0, 57) + '…' : s}`;
  }
  if (t === 'string') {
    const s = v as string;
    return `string "${s.length > 40 ? s.slice(0, 37) + '…' : s}"`;
  }
  return `${t} ${String(v)}`;
}

/** Turn one Ajv error into an actionable "<path>: expected X, got Y" line. */
function describeError(e: Ajv.ErrorObject): string {
  const path = e.dataPath || 'root';
  // params is a per-keyword union; we only read a few well-known fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = e.params as any;
  switch (e.keyword) {
    case 'type':
      return `${path}: expected ${params.type}, got ${describeValue(e.data)}`;
    case 'required':
      return `${path}: missing required property '${params.missingProperty}'`;
    case 'enum':
      return `${path}: must be one of ${JSON.stringify(params.allowedValues)}, got ${describeValue(e.data)}`;
    case 'additionalProperties':
      return `${path}: unexpected property '${params.additionalProperty}'`;
    default:
      return `${path}: ${e.message}`;
  }
}

// `Nullable(T)` = `anyOf:[T,null]`, so one bad value emits three Ajv errors
// (the real one + "should be null" + the "anyOf" wrapper). Keep only the specific
// branch and report expected-vs-received instead of a wall of noise.
function formatErrors(errors: Ajv.ErrorObject[] | null | undefined): string {
  if (!errors?.length) return 'unknown error';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signal = errors.filter(e => e.keyword !== 'anyOf' && (e.params as any)?.type !== 'null');
  const lines = Array.from(new Set((signal.length ? signal : errors).map(describeError)));
  let msg = lines.join('; ');
  // Bridge the single most-guessed mistake to the supported path: the agent keeps
  // stuffing per-series {name,color,label} objects into xCols/yCols (rejected),
  // when colors belong in styleConfig.colors and series renames in SQL aliases.
  if (/\.(xCols|yCols)\b/.test(msg)) {
    msg += '. Note: xCols/yCols must be arrays of column-name strings — for per-series colors use styleConfig.colors ({"0":"<colorKey>"}), and rename series via SQL aliases.';
  }
  return msg;
}

type ContentValidationInput =
  | { type: 'QuestionContent'; data: QuestionContent }
  | { type: 'DashboardContent'; data: DashboardContent }
  | { type: 'StoryContent'; data: StoryContent }
  | { type: 'NotebookContent'; data: NotebookContent }
  | { type: 'QuestionV2Content'; data: QuestionV2Content };

function validateContent(input: ContentValidationInput): string | null {
  const validate = validators[input.type];
  if (!validate(input.data)) {
    return formatErrors(validate.errors);
  }
  // Semantic cross-field check: not expressible in JSON Schema, so enforced here
  if (input.type === 'QuestionContent') {
    const viz = input.data.vizSettings;
    if (viz?.type === 'pivot' && viz?.pivotConfig == null) {
      return 'vizSettings.pivotConfig is required when type is "pivot"';
    }
  }
  if (input.type === 'StoryContent') {
    const assetIds = new Set(input.data.assets.map(a => a.id));
    for (const m of (input.data.story ?? '').matchAll(/data-question-id="(\d+)"/g)) {
      if (!assetIds.has(Number(m[1]))) {
        return `story embeds question ${m[1]} which is not in assets`;
      }
    }
  }
  return null;
}

/**
 * Validate file content by file type. Pass any object with { type, content, name?, path? } —
 * returns an error string or null if valid / no validator for that type.
 */
export function validateFileState(file: {
  type: FileType;
  content: unknown;
  name?: string;
  path?: string;
}): string | null {
  if (file.type === 'question')
    return validateContent({ type: 'QuestionContent', data: file.content as QuestionContent });
  if (file.type === 'dashboard')
    return validateContent({ type: 'DashboardContent', data: file.content as DashboardContent });
  if (file.type === 'story' || file.type === 'storyv2')
    return validateContent({ type: 'StoryContent', data: file.content as StoryContent });
  if (file.type === 'notebook')
    return validateContent({ type: 'NotebookContent', data: file.content as NotebookContent });
  if (file.type === 'questionv2')
    return validateContent({ type: 'QuestionV2Content', data: file.content as QuestionV2Content });
  if (file.type === 'config')
    return validateOrgConfig(file.content) ? null : 'Invalid config structure';
  if (file.type === 'connection') {
    const conn = file.content as any;
    if (!conn?.type || !conn?.config) return 'Connection must have type and config';
    if (file.name && !/^[a-z0-9_]+$/.test(file.name))
      return 'Connection name must contain only lowercase letters, numbers, and underscores';
    if (file.path && file.name && !file.path.endsWith(`/database/${file.name}`))
      return `Connection path must end with /database/${file.name}`;
  }
  return null;
}
