// The production FuzzyMatch tool must expose the documented params and fail
// gracefully when the agent context lacks an
// effectiveUser (it needs one to resolve the connection). Deep execution is
// shared with the v1 handler via executeFuzzyMatch and covered there.

import { describe, it, expect } from 'vitest';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { FuzzyMatch } from '@/agents/benchmark-analyst/db-tools.server';
import type { RemoteAnalystContext } from '@/agents/analyst/types';

describe('production FuzzyMatch tool', () => {
  it('exposes the documented parameters', () => {
    const props = (FuzzyMatch.schema.parameters as unknown as { properties: Record<string, unknown> }).properties;
    for (const key of ['connection_id', 'table', 'column', 'search_term', 'schema', 'limit', 'semantic_expansion', 'return_columns']) {
      expect(Object.keys(props)).toContain(key);
    }
    expect(FuzzyMatch.schema.name).toBe('FuzzyMatch');
  });

  it('returns an error result when effectiveUser is missing from context', async () => {
    const orch = new Orchestrator([], []);
    const ctx: RemoteAnalystContext = { userId: 'u', mode: 'org' };
    const tool = new FuzzyMatch(orch, { connection_id: 'c', table: 't', column: 'col', search_term: 'x' }, ctx);
    const res = await tool.run();
    const payload = JSON.parse((res as { content: { text: string }[] }).content[0].text);
    expect(payload.success).toBe(false);
  });
});
