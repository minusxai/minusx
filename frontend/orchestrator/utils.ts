// Small helpers shared by orchestrator + types modules.

import { randomBytes } from 'crypto';
import type { Usage } from '@mariozechner/pi-ai';

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
