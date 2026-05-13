import { fauxAssistantMessage, type TextContent } from '@mariozechner/pi-ai';
import { Orchestrator } from '@/orchestrator/orchestrator';
import {
  BenchmarkAnalystAgent,
  fauxRegistration,
} from '../benchmark-analyst';
import {
  BaseExecuteQuery,
  BaseSearchDBSchema,
  ListDBConnections,
  FuzzySearch,
} from '../db-tools';
import { ExploreDataset, setExploreModel } from '../explore-dataset';
import type { BenchmarkAnalystContext } from '../types';

// Mock connector so queries don't need a real DB.
vi.mock('../shared-duckdb', () => ({
  getOrCreateBenchmarkConnector: vi.fn(async () => ({
    query: vi.fn(async () => ({
      columns: ['track_id', 'title', 'artist'],
      types: ['INTEGER', 'VARCHAR', 'VARCHAR'],
      rows: [
        { track_id: 1, title: 'Get Me Bodied', artist: 'Beyoncé' },
        { track_id: 2, title: 'GetMe Bodied', artist: 'Beyoncé' },
        { track_id: 3, title: 'Beyoncé - Get Me Bodied', artist: '' },
      ],
    })),
    getSchema: vi.fn(async () => []),
    close: vi.fn(),
  })),
}));

const REGISTRABLES = [
  ListDBConnections,
  BaseSearchDBSchema,
  BaseExecuteQuery,
  BenchmarkAnalystAgent,
  FuzzySearch,
  ExploreDataset,
];

const CTX: BenchmarkAnalystContext = {
  connections: [
    { name: 'test_db', dialect: 'duckdb', description: 'test conn', config: { file_path: '/nonexistent/test.duckdb' } },
  ],
  contextDocs: 'test docs',
};

beforeAll(() => {
  setExploreModel(fauxRegistration.getModel());
});

describe('ExploreDataset', () => {
  it('executes query, passes results to LLM, and returns analysis', async () => {
    const analysisText = 'Group 1 (Get Me Bodied): track_ids 1, 2, 3';

    // The inner callLLM inside ExploreDataset will consume this response.
    fauxRegistration.setResponses([
      fauxAssistantMessage(analysisText, { stopReason: 'stop' }),
    ]);

    const orch = new Orchestrator(REGISTRABLES);
    const tool = new ExploreDataset(
      orch,
      {
        connection: 'test_db',
        query: 'SELECT track_id, title, artist FROM tracks',
        prompt: 'Identify duplicate tracks and group their track_ids',
      },
      CTX,
      'test-ed-1',
    );

    const result = await tool.run();

    expect(result.isError).toBe(false);
    const content = JSON.parse((result.content[0] as TextContent).text);
    expect(content.success).toBe(true);
    expect(content.analysis).toBe(analysisText);
    expect(result.details?.analysis).toBe(analysisText);
    expect(result.details?.queryRowCount).toBe(3);
  });

  it('returns error when connection is not found', async () => {
    const orch = new Orchestrator(REGISTRABLES);
    const ctx: BenchmarkAnalystContext = {
      connections: [], // no connections
      contextDocs: '',
    };
    const tool = new ExploreDataset(
      orch,
      {
        connection: 'nonexistent_db',
        query: 'SELECT 1',
        prompt: 'test',
      },
      ctx,
      'test-ed-bad',
    );

    const result = await tool.run();

    expect(result.isError).toBe(true);
    const content = JSON.parse((result.content[0] as TextContent).text);
    expect(content.success).toBe(false);
    expect(content.error).toContain('not found');
  });
});
