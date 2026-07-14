// WebAnalystAgent must advertise exactly this analyst tool set:
//   [ReadFiles, EditFile, ExecuteQuery, PublishAll, Navigate, Clarify,
//    SearchDBSchema, SearchFiles, CreateFile, LoadSkill, FuzzyMatch]
// Naming exception: it uses ClarifyFrontend for Clarify. It must NOT advertise
// extras like ListDBConnections.

import { describe, it, expect } from 'vitest';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { WebAnalystAgent } from '../web-analyst';
import type { RemoteAnalystContext } from '@/agents/analyst/types';

// The expected analyst tool names, with ClarifyFrontend substituted for Clarify.
const EXPECTED_TOOLS = [
  'ReadFiles',
  'EditFile',
  'ExecuteQuery',
  'PublishAll',
  'Navigate',
  'ClarifyFrontend',
  'SearchDBSchema',
  'SearchFiles',
  'CheckFileHealth',
  'CreateFile',
  'DetachViz',
  'LoadSkill',
  'LoadContext',
  'FuzzyMatch',
  'ReviewFile', // replaced Screenshot (rubric v2) — Screenshot survives only as a registered legacy alias
].sort();

describe('WebAnalystAgent tool-set', () => {
  it('advertises exactly the expected tool set (FuzzyMatch in, ListDBConnections out)', () => {
    const names = WebAnalystAgent.tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it('includes FuzzyMatch', () => {
    expect(WebAnalystAgent.tools.map((t) => t.name)).toContain('FuzzyMatch');
  });

  it('does not advertise ListDBConnections', () => {
    expect(WebAnalystAgent.tools.map((t) => t.name)).not.toContain('ListDBConnections');
  });

  it('enables Anthropic web search', () => {
    expect((WebAnalystAgent as unknown as { callOptions?: { webSearch?: unknown } }).callOptions?.webSearch).toBe(true);
  });

  it('injects web-search user_location (city) into per-request options when context.city is set', () => {
    const orch = new Orchestrator([], []);
    const ctx: RemoteAnalystContext = { userId: 'u', mode: 'org', city: 'Berlin' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent: any = new WebAnalystAgent(orch, { userMessage: 'q' }, ctx);
    expect(agent.resolveCallOptions().webSearch).toEqual({ userLocation: { city: 'Berlin' } });
  });

  it('leaves webSearch enabled without location when no city', () => {
    const orch = new Orchestrator([], []);
    const ctx: RemoteAnalystContext = { userId: 'u', mode: 'org' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent: any = new WebAnalystAgent(orch, { userMessage: 'q' }, ctx);
    expect(agent.resolveCallOptions().webSearch).toBe(true);
  });
});
