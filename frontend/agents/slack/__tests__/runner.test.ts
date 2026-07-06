import { runAgentTestSpec, type TestSpec } from '@/orchestrator/__tests__/support/test-spec-runner';
import { ExecuteQuery, ListDBConnections, SearchDBSchema } from '@/agents/analyst/analyst-agent';
import { SlackAgent, fauxRegistration } from '../slack-agent';
import specs from './specs/slack.faux.json';

// Faux specs don't touch a real DB; stub the production chokepoints
// (`runQuery`, `loadConnectionSchema`) so tools never reach `ConnectionsAPI` /
// `FilesAPI`. Tests assert agent behaviour around the tool layer.
vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, sql: string) => ({
    columns: [], types: [], rows: [], finalQuery: sql,
  })),
}));
vi.mock('@/lib/connections/load-schema', () => ({
  loadConnectionSchema: vi.fn(async () => []),
}));

const registrables = [ListDBConnections, SearchDBSchema, ExecuteQuery, SlackAgent];

describe.each(specs as TestSpec[])('faux spec: $name', (spec) => {
  it('passes all assertions', async () => {
    const { failures } = await runAgentTestSpec(spec, registrables, (steps) =>
      fauxRegistration.setResponses(steps),
    );
    expect(failures).toEqual([]);
  });
});
