/**
 * ExecuteQuery V2 viz-envelope image path (Viz Arch V2 §21 item 2/3). A `viz` envelope
 * on ExecuteQuery renders the chart IMAGE via `_renderVizEnvelopeJpeg` and wins over the
 * legacy `vizSettings`; a table envelope returns rows; legacy `vizSettings` still works.
 * Uses the `_executeFallback` seam to feed canned rows (no DB).
 */
import { describe, it, expect } from 'vitest';
import { BaseExecuteQuery } from '../db-tools';
import type { BenchmarkAnalystContext } from '../types';
import type { QueryResult } from '@/lib/connections/base';
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';

const ROWS: QueryResult = { columns: ['platform', 'revenue'], types: ['VARCHAR', 'INTEGER'], rows: [{ platform: 'ios', revenue: 10 }, { platform: 'web', revenue: 20 }], finalQuery: 'SELECT 1' };
const barEnv = { version: 2, source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: { mark: { type: 'bar' }, encoding: { x: { field: 'platform', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } } } as unknown as VizEnvelope;
const tableEnv = { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } } as unknown as VizEnvelope;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]);

const ctx: BenchmarkAnalystContext = { datasetKey: 'viz-test', connections: [] };

// Stub the DB + both renderers so we assert only the run() image-branch wiring.
class StubExecuteQuery extends BaseExecuteQuery {
  protected async _initialiseConnectors(): Promise<void> {}
  protected async _executeFallback(): Promise<QueryResult> { return ROWS; }
  public envelopeCalls = 0;
  public settingsCalls = 0;
  protected async _renderVizEnvelopeJpeg(): Promise<Buffer | null> { this.envelopeCalls++; return JPEG; }
  protected async _renderVizJpeg(): Promise<Buffer | null> { this.settingsCalls++; return JPEG; }
}

const make = (params: Record<string, unknown>) =>
  new StubExecuteQuery(undefined as never, { connectionId: 'c', query: 'SELECT 1', ...params }, ctx);

const hasImage = (res: { content: Array<{ type: string }> }) => res.content.some(c => c.type === 'image');

describe('ExecuteQuery viz envelope image', () => {
  it('renders a chart viz envelope as an image via the envelope renderer', async () => {
    const tool = make({ viz: barEnv });
    const res = await tool.run();
    expect(hasImage(res)).toBe(true);
    expect(tool.envelopeCalls).toBe(1);
    expect(tool.settingsCalls).toBe(0);
  });

  it('returns rows (no image) for a table envelope', async () => {
    const tool = make({ viz: tableEnv });
    const res = await tool.run();
    expect(hasImage(res)).toBe(false);
    expect(tool.envelopeCalls).toBe(0);
  });

  it('envelope wins over vizSettings when both are present', async () => {
    const tool = make({ viz: barEnv, vizSettings: { type: 'line' } });
    await tool.run();
    expect(tool.envelopeCalls).toBe(1);
    expect(tool.settingsCalls).toBe(0);
  });

  it('falls back to legacy vizSettings when no envelope is given', async () => {
    const tool = make({ vizSettings: { type: 'bar' } });
    const res = await tool.run();
    expect(hasImage(res)).toBe(true);
    expect(tool.settingsCalls).toBe(1);
    expect(tool.envelopeCalls).toBe(0);
  });
});
