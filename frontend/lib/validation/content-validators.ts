/**
 * Runtime validators for Atlas file content.
 * Compiled from the in-process JSON schema (lib/validation/atlas-json-schemas.ts),
 * which is built at module load from the TypeBox source.
 */
import Ajv from 'ajv';
import { atlasSchema } from './atlas-json-schemas';
import type { FileType, QuestionContent, DashboardContent, StoryContent } from '@/lib/types';
import { validateOrgConfig } from '@/lib/validation/config-validators';

const ajv = new Ajv({ allErrors: true });
ajv.addSchema(atlasSchema, 'atlas');

// Validators compiled once at module load — not per-call
const validators: Record<string, Ajv.ValidateFunction> = {
  QuestionContent: ajv.compile({ $ref: 'atlas#/$defs/QuestionContent' }),
  DashboardContent: ajv.compile({ $ref: 'atlas#/$defs/DashboardContent' }),
  StoryContent: ajv.compile({ $ref: 'atlas#/$defs/StoryContent' }),
};

function formatErrors(errors: Ajv.ErrorObject[] | null | undefined): string {
  if (!errors?.length) return 'unknown error';
  return errors.map(e => `${e.dataPath || 'root'}: ${e.message}`).join('; ');
}

type ContentValidationInput =
  | { type: 'QuestionContent'; data: QuestionContent }
  | { type: 'DashboardContent'; data: DashboardContent }
  | { type: 'StoryContent'; data: StoryContent };

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
  if (file.type === 'story')
    return validateContent({ type: 'StoryContent', data: file.content as StoryContent });
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
