/**
 * GuiBuilderRoot component tests (jsdom) — the single GUI tab's internal
 * Semantic · Simple · Full gradation:
 *  - default mode = highest tier the query supports
 *  - switching down always allowed; switching up gated with reasons
 *  - Semantic mode only offered when models exist, and only enterable when
 *    the SQL is semantic-owned (compiles from the persisted spec) or empty
 *  - explicit user choice is sticky
 */
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { GuiBuilderRoot } from '@/components/query-builder';
import { compileSemanticQuery } from '@/lib/semantic/compile';
import { irToSqlLocal } from '@/lib/sql/ir-to-sql';
import { CompletionsAPI } from '@/lib/data/completions/completions';
import type { SemanticModel } from '@/lib/types';
import type { SemanticQuerySpec } from '@/lib/validation/atlas-schemas';

vi.mock('@/lib/data/completions/completions', () => ({
  CompletionsAPI: {
    sqlToIR: vi.fn(),
    irToSql: vi.fn(),
    getColumnSuggestions: vi.fn(),
    getTableSuggestions: vi.fn(),
  },
}));

const api = CompletionsAPI as unknown as Record<string, ReturnType<typeof vi.fn>>;

const SIMPLE_IR = {
  type: 'simple', version: 1, from: { table: 'orders' },
  select: [
    { type: 'column', column: 'status' },
    { type: 'aggregate', aggregate: 'COUNT', column: null, alias: 'n' },
  ],
  group_by: { columns: [{ column: 'status' }] },
};

const ORDERS_MODEL: SemanticModel = {
  name: 'Orders',
  connection: 'warehouse',
  table: 'orders',
  timeDimension: { column: 'created_at' },
  dimensions: [{ name: 'Status', column: 'status' }],
  measures: [{ name: 'Revenue', agg: 'SUM', column: 'total' }],
};

const SEMANTIC_SPEC: SemanticQuerySpec = {
  model: 'Orders', measures: ['Revenue'], dimensions: ['Status'], timeGrain: 'MONTH',
};
const SEMANTIC_SQL = irToSqlLocal(compileSemanticQuery(SEMANTIC_SPEC, ORDERS_MODEL), 'duckdb');

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.sqlToIR.mockResolvedValue({ success: true, ir: SIMPLE_IR });
  api.irToSql.mockResolvedValue({ success: true, sql: 'SELECT generated' });
  api.getColumnSuggestions.mockResolvedValue({ success: true, columns: [] });
  api.getTableSuggestions.mockResolvedValue({ success: true, tables: [] });
});

const renderRoot = (props: Partial<React.ComponentProps<typeof GuiBuilderRoot>> = {}) =>
  renderWithProviders(
    <GuiBuilderRoot
      databaseName="warehouse"
      dialect="duckdb"
      sql="SELECT status, COUNT(*) AS n FROM orders GROUP BY status"
      onSqlChange={vi.fn()}
      canUseSimple
      {...props}
    />
  );

const pressed = (label: string) => screen.getByLabelText(label).getAttribute('aria-pressed');

describe('GuiBuilderRoot', () => {
  it('defaults to Simple when the query fits, with Full available', async () => {
    renderRoot();
    expect(pressed('Simple mode')).toBe('true');
    expect(pressed('Full mode')).toBe('false');
    // Simple builder is mounted (its measure section renders).
    expect(await screen.findByLabelText('Add measure')).toBeTruthy();
  });

  it('defaults to Full when the query does not fit Simple, greying Simple with the reason', () => {
    renderRoot({ canUseSimple: false, simpleError: 'Not available in Simple mode: joins' });
    expect(pressed('Full mode')).toBe('true');
    const simple = screen.getByLabelText('Simple mode');
    expect(simple.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(simple);
    expect(pressed('Full mode')).toBe('true'); // click ignored
  });

  it('hides the Semantic mode entirely without models', () => {
    renderRoot();
    expect(screen.queryByLabelText('Semantic mode')).toBeNull();
  });

  it('defaults to Semantic when the persisted spec compiles to the current SQL', () => {
    renderRoot({
      sql: SEMANTIC_SQL,
      semanticModels: [ORDERS_MODEL],
      semanticQuery: SEMANTIC_SPEC,
      onSemanticChange: vi.fn(),
    });
    expect(pressed('Semantic mode')).toBe('true');
    // Semantic builder is mounted (curated measure chip).
    expect(screen.getAllByText('Revenue').length).toBeGreaterThan(0);
  });

  it('greys Semantic when the SQL was not built semantically, but offers it on empty SQL', () => {
    renderRoot({
      semanticModels: [ORDERS_MODEL],
      semanticQuery: null,
      onSemanticChange: vi.fn(),
    });
    expect(screen.getByLabelText('Semantic mode').getAttribute('aria-disabled')).toBe('true');

    // Fresh question: semantic is enterable (nothing to clobber).
    renderRoot({
      sql: '',
      semanticModels: [ORDERS_MODEL],
      semanticQuery: null,
      onSemanticChange: vi.fn(),
    });
    const semanticButtons = screen.getAllByLabelText('Semantic mode');
    expect(semanticButtons.at(-1)!.getAttribute('aria-disabled')).toBe('false');
  });

  it('switching down to Full is always allowed and sticky', async () => {
    renderRoot();
    fireEvent.click(screen.getByLabelText('Full mode'));
    expect(pressed('Full mode')).toBe('true');
    expect(pressed('Simple mode')).toBe('false');
    // Simple builder unmounted, full builder takes over.
    expect(screen.queryByLabelText('Add measure')).toBeNull();
  });

  it('allows switching back up when the query still fits', () => {
    renderRoot();
    fireEvent.click(screen.getByLabelText('Full mode'));
    fireEvent.click(screen.getByLabelText('Simple mode'));
    expect(pressed('Simple mode')).toBe('true');
  });
});
