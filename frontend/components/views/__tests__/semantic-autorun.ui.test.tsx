/**
 * Semantic auto-run — editing the spec in the GUI executes the freshly
 * compiled query automatically (debounced), no Run click needed, so the
 * chart tracks every shelf edit. The toggle in the explorer's strip pauses
 * it. Mounted as QuestionViewV2 directly (props, not the container) with a
 * stateful wrapper so content edits flow back in like Redux would.
 */
import React, { useState } from 'react';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import QuestionViewV2 from '@/components/views/QuestionViewV2';
import type { QuestionContent, SemanticModelV2 } from '@/lib/types';

const ORDERS_MODEL: SemanticModelV2 = {
  name: 'Orders',
  connection: 'warehouse',
  primary: { kind: 'table', table: 'orders' },
  timeDimension: { column: 'created_at', label: 'Order date' },
  dimensions: [{ name: 'Status', source: 'primary', column: 'status' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'amount' }],
};

const SPEC = { model: 'Orders', table: 'orders', measures: ['Revenue'], dimensions: [] };

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

function Harness({ onExecute }: { onExecute: (v?: Record<string, unknown>) => void }) {
  const [content, setContent] = useState<QuestionContent>({
    description: null,
    query: 'SELECT 1 AS seed',
    vizSettings: { type: 'table' },
    parameters: [],
    parameterValues: {},
    connection_name: 'warehouse',
    references: [],
    cachePolicy: null,
    semanticQuery: SPEC,
  } as unknown as QuestionContent);
  return (
    <QuestionViewV2
      viewMode="page"
      content={content}
      queryData={null}
      queryLoading={false}
      queryError={null}
      queryStale={false}
      collapsedPanel="none"
      onTogglePanel={() => {}}
      fileState={{}}
      onSetFile={() => {}}
      onChange={(updates) => setContent((prev) => ({ ...prev, ...updates }))}
      onExecute={onExecute}
    />
  );
}

describe('QuestionViewV2 — semantic auto-run', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a shelf edit executes the compiled query automatically after the debounce', () => {
    const onExecute = vi.fn();
    renderWithProviders(<Harness onExecute={onExecute} />);

    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    expect(onExecute).not.toHaveBeenCalled(); // debounced, not instant

    act(() => { vi.advanceTimersByTime(600); });
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it('pausing auto-run stops the automatic execution; Run still works', () => {
    const onExecute = vi.fn();
    renderWithProviders(<Harness onExecute={onExecute} />);

    fireEvent.click(screen.getByLabelText('Toggle auto-run'));
    fireEvent.click(screen.getByLabelText('Field dimension: Status'));
    act(() => { vi.advanceTimersByTime(600); });
    expect(onExecute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Execute semantic query'));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });
});
