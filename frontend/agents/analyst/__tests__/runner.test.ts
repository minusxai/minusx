import { runAgentTestSpec, type TestSpec } from '@/orchestrator/__tests__/support/test-spec-runner';
import {
  RemoteAnalystAgent,
  ExecuteQuery,
  ListDBConnections,
  SearchDBSchema,
  fauxRegistration,
} from '../analyst-agent';
import specs from './specs/analyst.faux.json';

// Production tools (`SearchDBSchema`, `ExecuteQuery`) route via the
// `runQuery` / `loadConnectionSchema` helpers. Faux specs don't exercise
// real DB calls, so we mock both at the module level to return empty data
// — the test asserts agent behaviour around the tool layer, not the
// underlying query execution.
vi.mock('@/lib/connections/run-query', () => ({
  runQuery: vi.fn(async (_db: string, query: string) => ({
    columns: [], types: [], rows: [], finalQuery: query,
  })),
}));
vi.mock('@/lib/connections/load-schema', () => ({
  loadConnectionSchema: vi.fn(async () => []),
}));

const registrables = [ListDBConnections, SearchDBSchema, ExecuteQuery, RemoteAnalystAgent];

describe.each(specs as TestSpec[])('faux spec: $name', (spec) => {
  it('passes all assertions', async () => {
    const { failures } = await runAgentTestSpec(spec, registrables, (steps) =>
      fauxRegistration.setResponses(steps),
    );
    expect(failures).toEqual([]);
  });
});
