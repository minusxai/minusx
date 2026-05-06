import { runAgentTestSpec, type TestSpec } from '@/orchestrator/test-spec-runner';
import {
  AnalystAgent,
  ExecuteSQL,
  ListDBConnections,
  SearchDBSchema,
  fauxRegistration,
} from '../analyst-agent';
import { resetSources, setSchemaSource, setSqlExecutor } from '../sources';
import specs from './specs/analyst.faux.json';

const registrables = [ListDBConnections, SearchDBSchema, ExecuteSQL, AnalystAgent];

describe.each(specs as TestSpec[])('faux spec: $name', (spec) => {
  beforeEach(() => {
    resetSources();
    setSchemaSource({ search: async () => [] });
    setSqlExecutor({ execute: async () => ({ rows: [] }) });
  });

  it('passes all assertions', async () => {
    const { failures } = await runAgentTestSpec(spec, registrables, (steps) =>
      fauxRegistration.setResponses(steps),
    );
    expect(failures).toEqual([]);
  });
});
