
import { randomBytes } from 'crypto';
import type { Static, TSchema } from 'typebox';
import type { Api, AssistantMessage, Usage } from '@/orchestrator/llm';
import { Convert, Default, Errors, Check } from 'typebox/value';

export function gen_id(): string {
  return `mxgen_${randomBytes(12).toString('hex')}`;
}

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/**
 * Coerce *stringified* tool-call arguments back to their schema's types. Models
 * occasionally emit arguments with every value stringified — even on the native
 * Anthropic API — e.g. `{ fileIds: "[2158]", maxChars: "3000", runQueries:
 * "false" }` instead of `{ fileIds: [2158], maxChars: 3000, runQueries: false }`.
 * Left un-coerced these are stored verbatim in the conversation log and handed to
 * tools, which then crash (e.g. a chat display calling `args.fileIds.map(...)` on
 * a string).
 *
 * Deliberately narrow: only acts when a value is a **string** but its schema
 * expects a non-string type (array, object, number, integer, boolean). Such a
 * value is `JSON.parse`d (`"[2158]"` → `[2158]`, `"3000"` → `3000`, `"false"` →
 * `false`), then `Convert`ed against the property schema to fix nested primitives
 * (`["7","8"]` → `[7, 8]`). Everything else is left untouched — a genuine
 * wrong-type arg (e.g. a number passed to a string field, or a missing required
 * field) still fails validation and surfaces as a recoverable tool error, rather
 * than being silently coerced.
 */
export function coerceParameters<T extends TSchema>(
  schema: T,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const props = (schema as { properties?: Record<string, TSchema> }).properties ?? {};
  const out: Record<string, unknown> = { ...parameters };
  for (const key of Object.keys(out)) {
    const value = out[key];
    const prop = props[key];
    if (typeof value !== 'string' || !prop) continue;
    if (!/"type":"(array|object|number|integer|boolean)"/.test(JSON.stringify(prop))) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue; // Not valid JSON — leave the string for validation to reject.
    }
    out[key] = Convert(prop, parsed);
  }
  return out;
}

export function normalizeParameters<T extends TSchema>(
  schema: T,
  parameters: Record<string, unknown>,
): Static<T> {
  return Default(schema, coerceParameters(schema, parameters)) as Static<T>;
}

export type ParameterValidation<T extends TSchema> =
  | { ok: true; value: Static<T> }
  | { ok: false; errors: string[] };

export function validateParameters<T extends TSchema>(
  schema: T,
  parameters: Record<string, unknown>,
): ParameterValidation<T> {
  const withDefaults = Default(schema, coerceParameters(schema, parameters));
  if (Check(schema, withDefaults)) {
    return { ok: true, value: withDefaults as Static<T> };
  }
  const errors: string[] = [];
  for (const e of Errors(schema, withDefaults)) {
    const path = (e as { path?: string }).path;
    const prefix = path && path.length > 0 ? path : '/';
    errors.push(`${prefix}: ${e.message}`);
  }
  return { ok: false, errors };
}

export function synthErrorAssistantMessage(
  errorMessage: string,
  extra?: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: errorMessage }],
    api: 'unknown' as Api,
    provider: 'unknown',
    model: 'unknown',
    usage: EMPTY_USAGE,
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
    ...extra,
  };
}
