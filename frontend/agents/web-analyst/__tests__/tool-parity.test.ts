// WebAnalystAgent must advertise the same tool set as Python's production
// AnalystAgent (backend/tasks/agents/analyst/agent.py → _get_available_tools):
//   [ReadFiles, EditFile, ExecuteQuery, PublishAll, Navigate, Clarify,
//    SearchDBSchema, SearchFiles, CreateFile, LoadSkill, FuzzyMatch]
// Known intentional naming exception: v2 uses ClarifyFrontend for Clarify
// (the rename was deliberately not done). v2 must NOT advertise extras like
// ListDBConnections that Python's analyst doesn't have.

import { describe, it, expect } from 'vitest';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { WebAnalystAgent } from '../web-analyst';
import type { RemoteAnalystContext } from '@/agents/analyst/types';

// Python's AnalystAgent tool names, with v2's ClarifyFrontend substituted for Clarify.
const EXPECTED_TOOLS = [
  'ReadFiles',
  'EditFile',
  'ExecuteQuery',
  'PublishAll',
  'Navigate',
  'ClarifyFrontend',
  'SearchDBSchema',
  'SearchFiles',
  'CreateFile',
  'LoadSkill',
  'FuzzyMatch',
].sort();

describe('WebAnalystAgent tool-set parity with Python AnalystAgent', () => {
  it('advertises exactly the Python analyst tool set (FuzzyMatch in, ListDBConnections out)', () => {
    const names = WebAnalystAgent.tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });

  it('includes FuzzyMatch', () => {
    expect(WebAnalystAgent.tools.map((t) => t.name)).toContain('FuzzyMatch');
  });

  it('does not advertise ListDBConnections (Python analyst has no such tool)', () => {
    expect(WebAnalystAgent.tools.map((t) => t.name)).not.toContain('ListDBConnections');
  });

  it('enables Anthropic web search (matches Python include_web_search=True)', () => {
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
