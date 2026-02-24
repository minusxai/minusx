/**
 * Runtime validators for Atlas file content.
 * Compiled from the Pydantic-generated JSON schema (atlas-schema.gen.json).
 * To regenerate: cd frontend && npm run generate-types
 */
import Ajv from 'ajv';
import atlasSchema from './atlas-schema.gen.json';
import type { FileType, QuestionContent, DashboardContent } from '@/lib/types';

const ajv = new Ajv({ allErrors: true });
ajv.addSchema(atlasSchema, 'atlas');

// Validators compiled once at module load — not per-call
const validators: Record<string, Ajv.ValidateFunction> = {
  QuestionContent: ajv.compile({ $ref: 'atlas#/$defs/QuestionContent' }),
  DashboardContent: ajv.compile({ $ref: 'atlas#/$defs/DashboardContent' }),
};

function formatErrors(errors: Ajv.ErrorObject[] | null | undefined): string {
  if (!errors?.length) return 'unknown error';
  return errors.map(e => `${e.dataPath || 'root'}: ${e.message}`).join('; ');
}

type ContentValidationInput =
  | { type: 'QuestionContent'; data: QuestionContent }
  | { type: 'DashboardContent'; data: DashboardContent };

function validateContent(input: ContentValidationInput): string | null {
  const validate = validators[input.type];
  if (!validate(input.data)) {
    return formatErrors(validate.errors);
  }
  // Semantic cross-field check: Pydantic's .refine() doesn't survive JSON Schema codegen
  if (input.type === 'QuestionContent') {
    const viz = input.data.vizSettings;
    if (viz?.type === 'pivot' && viz?.pivotConfig == null) {
      return 'vizSettings.pivotConfig is required when type is "pivot"';
    }
  }
  return null;
}

/**
 * Validate file content by file type. Pass any object with { type, content } —
 * returns an error string or null if valid / no validator for that type.
 */
export function validateFileState(file: { type: FileType; content: unknown }): string | null {
  if (file.type === 'question')
    return validateContent({ type: 'QuestionContent', data: file.content as QuestionContent });
  if (file.type === 'dashboard')
    return validateContent({ type: 'DashboardContent', data: file.content as DashboardContent });
  return null;
}
