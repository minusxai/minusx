// WebAnalystAgent must advertise the same tool set as Python's production
// AnalystAgent (backend/tasks/agents/analyst/agent.py → _get_available_tools):
//   [ReadFiles, EditFile, ExecuteQuery, PublishAll, Navigate, Clarify,
//    SearchDBSchema, SearchFiles, CreateFile, LoadSkill, FuzzyMatch]
// Known intentional naming exception: v2 uses ClarifyFrontend for Clarify
// (the rename was deliberately not done). v2 must NOT advertise extras like
// ListDBConnections that Python's analyst doesn't have.

import { describe, it, expect } from 'vitest';
import { WebAnalystAgent } from '../web-analyst';

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
});
