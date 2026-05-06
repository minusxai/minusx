
import { randomBytes } from 'crypto';
import type { Api, AssistantMessage, Static, TSchema, Usage } from '@mariozechner/pi-ai';
import { Default, Errors, Check } from 'typebox/value';

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

export function normalizeParameters<T extends TSchema>(
  schema: T,
  parameters: Record<string, unknown>,
): Static<T> {
  return Default(schema, { ...parameters }) as Static<T>;
}

export type ParameterValidation<T extends TSchema> =
  | { ok: true; value: Static<T> }
  | { ok: false; errors: string[] };

export function validateParameters<T extends TSchema>(
  schema: T,
  parameters: Record<string, unknown>,
): ParameterValidation<T> {
  const withDefaults = Default(schema, { ...parameters });
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
