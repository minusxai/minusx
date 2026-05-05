
import { randomBytes } from 'crypto';
import type { Api, AssistantMessage, Static, TSchema, Usage } from '@mariozechner/pi-ai';
import { Default } from 'typebox/value';

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

export function normalizeArgs<T extends TSchema>(
  schema: T,
  args: Record<string, unknown>,
): Static<T> {
  return Default(schema, { ...args }) as Static<T>;
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
