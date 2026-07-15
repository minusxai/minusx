/**
 * Chart type lock — semantic exploration auto-infers the chart type ONLY
 * until the user manually picks one (vizSettings.typeLocked). A manual pick
 * survives every subsequent shelf edit; the "Auto" badge in the viz panel
 * hands control back to inference. Recommended types (from the spec's shape,
 * lib/semantic/infer-viz) are highlighted in the type selector; the rest dim
 * but stay clickable.
 *
 * Mounted as QuestionViewV2 directly with a stateful wrapper (like
 * semantic-autorun.ui.test.tsx). QuestionVisualization is mocked out so a
 * non-null queryData doesn't drag ECharts into jsdom — the viz PANEL (type
 * selector + config) is what's under test, and that renders from queryData
 * columns alone.
 */
import React, { useState } from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import QuestionViewV2 from '@/components/views/QuestionViewV2';
import type { QuestionContent, SemanticModel, VizSettings } from '@/lib/types';

const ORDERS_MODEL: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  table: 'orders',
  timeDimension: { column: 'created_at', label: 'Order date' },
  dimensions: [{ name: 'Status', column: 'status' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'amount' }],
};

// Time grain set → inference says 'line' whenever it gets to choose.
const SPEC = { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [], timeGrain: 'MONTH' as const };

vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({ databases: [{ databaseName: 'warehouse', schemas: [] }], hasContext: false }),
}));
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: {
      warehouse: { metadata: { name: 'warehouse', type: 'duckdb', config: {}, created_at: '', updated_at: '' }, schema: null },
    },
    loading: false,
    error: null,
  }),
}));
vi.mock('@/lib/hooks/use-semantic-compat', () => ({
  useSemanticCompat: () => ({ detected: SPEC, canUseSemantic: true }),
}));
vi.mock('@/lib/hooks/use-semantic-models', () => ({
  useSemanticModels: () => ({ models: [ORDERS_MODEL] }),
}));
vi.mock('@/lib/semantic/derive', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  deriveModelStubs: () => [{ name: 'Orders', connection: 'warehouse', table: 'orders' }],
}));
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'MinusX' } }, loading: false }),
}));
vi.mock('@/components/question/QuestionVisualization', () => ({
  QuestionVisualization: () => null,
}));

const QUERY_DATA = { columns: ['month', 'revenue'], types: ['date', 'number'], rows: [['2025-01-01', 10]] };

function Harness({ vizSettings, latest }: { vizSettings: VizSettings; latest: { content?: QuestionContent } }) {
  const [content, setContent] = useState<QuestionContent>({
    description: null,
    query: 'SELECT 1 AS seed',
    vizSettings,
    parameters: [],
    parameterValues: {},
    connection_name: 'warehouse',
    references: [],
    cachePolicy: null,
    semanticQuery: SPEC,
  } as unknown as QuestionContent);
  latest.content = content;
  return (
    <QuestionViewV2
      viewMode="page"
      content={content}
      queryData={QUERY_DATA}
      queryLoading={false}
      queryError={null}
      queryStale={false}
      collapsedPanel="none"
      onTogglePanel={() => {}}
      fileState={{}}
      onSetFile={() => {}}
      onChange={(updates) => setContent((prev) => ({ ...prev, ...updates }))}
      onExecute={() => {}}
    />
  );
}

function mount(vizSettings: VizSettings) {
  const latest: { content?: QuestionContent } = {};
  renderWithProviders(<Harness vizSettings={vizSettings} latest={latest} />);
  return latest;
}

describe('QuestionViewV2 — chart type lock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a LOCKED type survives shelf edits (axes still track the query)', async () => {
    const latest = mount({ type: 'bar', typeLocked: true, xCols: ['month'], yCols: ['revenue'] });

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await waitFor(() => {
      expect(latest.content?.vizSettings?.xCols).toContain('status');
    });
    expect(latest.content?.vizSettings?.type).toBe('bar');
  });

  it('legacy fallback: an UNLOCKED in-family type still auto-switches', async () => {
    const latest = mount({ type: 'bar', xCols: ['month'], yCols: ['revenue'] });

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    await waitFor(() => {
      expect(latest.content?.vizSettings?.type).toBe('line'); // inferred: time grain present
    });
  });

  it('manually picking a type LOCKS it', async () => {
    const latest = mount({ type: 'line', xCols: ['month'], yCols: ['revenue'] });

    fireEvent.click(screen.getByLabelText('Pie'));
    await waitFor(() => {
      expect(latest.content?.vizSettings?.type).toBe('pie');
      expect(latest.content?.vizSettings?.typeLocked).toBe(true);
    });
  });

  it('the Auto badge unlocks and immediately re-infers the type', async () => {
    const latest = mount({ type: 'bar', typeLocked: true, xCols: ['month'], yCols: ['revenue'] });

    fireEvent.click(screen.getByLabelText('Toggle auto chart type'));
    await waitFor(() => {
      expect(latest.content?.vizSettings?.typeLocked).toBe(false);
      expect(latest.content?.vizSettings?.type).toBe('line'); // re-inferred from the spec
    });
  });

  it('recommended types are marked in the selector; the rest stay clickable', () => {
    mount({ type: 'line', xCols: ['month'], yCols: ['revenue'] });

    // time series shape: line recommended, pie not — but still a button
    expect(screen.getByLabelText('Line').getAttribute('data-recommended')).toBe('true');
    expect(screen.getByLabelText('Pie').getAttribute('data-recommended')).toBeNull();
    fireEvent.click(screen.getByLabelText('Pie')); // clickable, no throw
  });
});
