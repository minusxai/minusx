// SearchDBSchema's connection param must be `connection_id` — that's what the
// system prompt advertises (`SearchDBSchema(connection_id, query?)`). v2 had
// `connection`, so a prompt-following model would pass a key the tool didn't read.
import { describe, it, expect } from 'vitest';
import { Orchestrator } from '@/orchestrator/orchestrator';
import { BaseSearchDBSchema } from '@/agents/benchmark-analyst/db-tools';
import type { SchemaEntry } from '@/lib/connections/base';

// Records the connection name the handler resolves against.
class RecordingSearchDBSchema extends BaseSearchDBSchema {
  resolvedConnection: string | undefined;
  protected override async _initialiseConnectors(): Promise<void> {
    // no-op → no local connectors → run() falls through to _loadSchemaFallback
  }
  protected override async _loadSchemaFallback(connection: string): Promise<SchemaEntry[]> {
    this.resolvedConnection = connection;
    return [];
  }
}

describe('SearchDBSchema — connection_id parity', () => {
  it('schema exposes `connection_id` (not `connection`)', () => {
    const props = (BaseSearchDBSchema.schema.parameters as unknown as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toContain('connection_id');
    expect(Object.keys(props)).not.toContain('connection');
  });

  it('resolves the schema against the agent-supplied connection_id', async () => {
    const orch = new Orchestrator([], []);
    const tool = new RecordingSearchDBSchema(
      orch,
      { connection_id: 'mydb', query: '' },
      { connections: [] } as never,
    );
    await tool.run();
    expect(tool.resolvedConnection).toBe('mydb');
  });
});
