// Small helpers shared by orchestrator + types modules.

import { randomBytes } from 'crypto';
import type { Static, TSchema, Usage } from '@mariozechner/pi-ai';
import { Default } from 'typebox/value';

export function gen_id(): string {
  return `mxgen_${randomBytes(12).toString('hex')}`;
}

// Empty Usage block stamped onto synthetic AssistantMessages we construct
// (e.g. orchestrator's synthErrorEvent). Real LLM responses get their own
// usage from pi-ai.
export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

// Patches missing properties on `args` using `Default()` annotations from the
// schema. Used at construction sites in dispatch / reconstructAgent so the
// LLM can omit fields that have schema-level defaults.
export function normalizeArgs<T extends TSchema>(
  schema: T,
  args: Record<string, unknown>,
): Static<T> {
  return Default(schema, { ...args }) as Static<T>;
}
