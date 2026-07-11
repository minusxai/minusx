import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { QuestionVisualization } from '@/components/question/QuestionVisualization'
import { VegaVizPanel } from '@/components/viz/VegaVizPanel'
import type { VizEnvelope, PivotConfig } from '@/lib/validation/atlas-schemas'
import type { QuestionContent, QueryResult } from '@/lib/types'

// ─── Mocks: heavy renderers not under test (PivotTable stays REAL) ───────────

vi.mock('@/components/viz/VegaChart', () => ({
  default: () => <div aria-label="Vega chart surface" />,
}))
vi.mock('@/components/plotx/ChartBuilder', () => ({
  ChartBuilder: () => <div aria-label="Classic chart builder" />,
}))
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({
    config: { branding: { agentName: 'Agent' } },
    configs: [],
    loading: false,
    error: null,
    reloadConfigs: vi.fn(),
  }),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONFIG: PivotConfig = {
  rows: ['region'],
  columns: ['month'],
  values: [{ column: 'revenue', aggFunction: 'SUM' }],
}

const pivotViz = (extra: Record<string, unknown> = {}): VizEnvelope => ({
  version: 2,
  source: { kind: 'pivot', config: CONFIG, columnFormats: null, css: null, ...extra },
}) as unknown as VizEnvelope

const DATA: QueryResult = {
  columns: ['region', 'month', 'revenue'],
  types: ['VARCHAR', 'VARCHAR', 'DOUBLE'],
  rows: [
    { region: 'West', month: 'Jan', revenue: 100 },
    { region: 'West', month: 'Feb', revenue: 150 },
    { region: 'East', month: 'Jan', revenue: 200 },
    { region: 'East', month: 'Feb', revenue: 50 },
  ],
}

const content = (viz: VizEnvelope): QuestionContent => ({
  query: 'SELECT 1',
  connection_name: 'static',
  vizSettings: { type: 'table', xCols: [], yCols: [] },
  viz,
}) as unknown as QuestionContent

const CONFIG_UI = {
  showHeader: false,
  showJsonToggle: false,
  editable: true,
  viz: { showTypeButtons: false, showChartBuilder: false, typesButtonsOrientation: 'horizontal' as const, showTitle: false },
  fixError: false,
}

function renderViz(viz: VizEnvelope, onVizChange = vi.fn()) {
  renderWithProviders(
    <QuestionVisualization
      currentState={content(viz)}
      config={CONFIG_UI}
      loading={false}
      error={null}
      data={DATA}
      onVizTypeChange={vi.fn()}
      onAxisChange={vi.fn()}
      onVizChange={onVizChange}
    />
  )
  return onVizChange
}

// ─── QuestionVisualization routing ───────────────────────────────────────────

describe('QuestionVisualization — pivot envelope routing', () => {
  it('renders the real PivotTable (aggregated cells) for a pivot envelope', () => {
    renderViz(pivotViz())
    // Aggregated values appear as cells; the vega surface must not mount.
    expect(screen.getByText('West')).toBeInTheDocument()
    expect(screen.getByText('East')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface')).not.toBeInTheDocument()
  })

  it('exposes the pivot class contract and scoped css injection', () => {
    renderViz(pivotViz({ css: '.mx-pivot th { background: rgb(9, 9, 9); }' }))
    expect(document.querySelector('.mx-pivot')).toBeTruthy()
    const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent ?? '')
    const scoped = styles.find(s => s.includes('.mx-pivot th'))
    expect(scoped).toBeTruthy()
    expect(scoped!.trim().startsWith('.mx-pivot')).toBe(false) // nested under the scope class
  })
})

// ─── VegaVizPanel — pivot state ──────────────────────────────────────────────

describe('VegaVizPanel — pivot envelope', () => {
  function renderPanel(viz: VizEnvelope, onVizChange = vi.fn()) {
    renderWithProviders(
      <VegaVizPanel envelope={viz} columns={DATA.columns} types={DATA.types} onVizChange={onVizChange} />
    )
    return onVizChange
  }

  it('Pivot icon is enabled and selected; no CUSTOM badge', () => {
    renderPanel(pivotViz())
    expect(screen.getByLabelText('Pivot')).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByLabelText('Custom spec indicator')).not.toBeInTheDocument()
  })

  it('Fields tab hosts the pivot axis builder (Rows/Columns/Values zones)', () => {
    renderPanel(pivotViz())
    // getAllBy — PivotAxisBuilder renders zone labels that can repeat elsewhere in it
    expect(screen.getAllByText('Rows').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Columns').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Values').length).toBeGreaterThan(0)
  })

  it('Settings tab hosts the CSS override editor for pivot', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel(pivotViz())
    await user.click(screen.getByLabelText('Settings tab'))

    const cssEditor = screen.getByLabelText('CSS overrides')
    await user.click(cssEditor)
    await user.type(cssEditor, '.mx-pivot th {{ color: red; }')
    await user.tab()

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    expect((next.source as unknown as { css: string }).css).toContain('.mx-pivot th')
  })

  it('switching table → pivot via the icon seeds config from the columns', async () => {
    const user = userEvent.setup()
    const table = { version: 2, source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null } } as unknown as VizEnvelope
    const onVizChange = renderPanel(table)
    await user.click(screen.getByLabelText('Pivot'))
    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { kind: string; config: PivotConfig }
    expect(source.kind).toBe('pivot')
    expect(source.config.values[0].column).toBe('revenue')
  })
})
