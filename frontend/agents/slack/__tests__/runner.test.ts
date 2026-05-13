import { runAgentTestSpec, type TestSpec } from '@/orchestrator/test-spec-runner';
import { ExecuteQuery, ListDBConnections, SearchDBSchema } from '@/agents/analyst/analyst-agent';
import { SlackAgent, fauxRegistration } from '../slack-agent';
import {
  resetSources,
  setSchemaSource,
  setSqlExecutor,
} from '@/agents/analyst/sources';
import specs from './specs/slack.faux.json';

const registrables = [ListDBConnections, SearchDBSchema, ExecuteQuery, SlackAgent];

describe.each(specs as TestSpec[])('faux spec: $name', (spec) => {
  beforeEach(() => {
    resetSources();
    setSchemaSource({ getSchema: async () => [] });
    setSqlExecutor({ execute: async () => ({ rows: [] }) });
  });

  it('passes all assertions', async () => {
    const { failures } = await runAgentTestSpec(spec, registrables, (steps) =>
      fauxRegistration.setResponses(steps),
    );
    expect(failures).toEqual([]);
  });
});
