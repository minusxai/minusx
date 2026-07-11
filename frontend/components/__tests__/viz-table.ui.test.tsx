import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { QuestionVisualization } from '@/components/question/QuestionVisualization'
import { VegaVizPanel } from '@/components/viz/VegaVizPanel'
import type { VizEnvelope } from '@/lib/validation/atlas-schemas'
import type { QuestionContent, QueryResult } from '@/lib/types'

// ─── Mocks: heavy renderers not under test ───────────────────────────────────

// The vega renderer must NOT mount for table envelopes — marker div proves routing.
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

// TableV2 stays REAL (full functionality reuse is the point) — mock its duckdb deps.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({ index: i, start: i * 41, end: (i + 1) * 41, size: 41 })),
    getTotalSize: () => count * 41,
  }),
}))
vi.mock('@/lib/database/duckdb', () => ({
  calculateColumnStats: vi.fn().mockResolvedValue({}),
  getColumnType: (t: string) => {
    if (['INTEGER', 'BIGINT', 'DOUBLE', 'FLOAT', 'DECIMAL'].some(n => t.toUpperCase().includes(n))) return 'number'
    if (['DATE', 'TIMESTAMP'].some(n => t.toUpperCase().includes(n))) return 'date'
    return 'text'
  },
  loadDataIntoTable: vi.fn().mockResolvedValue(undefined),
  generateRandomTableName: () => 'test_table',
}))
vi.mock('@/lib/chart/histogram', () => ({
  calculateHistogram: vi.fn().mockResolvedValue([]),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const tableViz = (extra: Record<string, unknown> = {}): VizEnvelope => ({
  version: 2,
  source: { kind: 'table', columnFormats: null, conditionalFormats: null, css: null, ...extra },
}) as unknown as VizEnvelope

const vegaViz: VizEnvelope = {
  version: 2,
  source: {
    kind: 'vega-lite',
    grammar: 'vega-lite@6',
    spec: {
      mark: { type: 'bar' },
      encoding: {
        x: { field: 'region', type: 'nominal' },
        y: { field: 'revenue', type: 'quantitative' },
      },
    },
  },
} as unknown as VizEnvelope

const DATA: QueryResult = {
  columns: ['region', 'revenue'],
  types: ['VARCHAR', 'DOUBLE'],
  rows: [
    { region: 'West', revenue: 100 },
    { region: 'East', revenue: 200 },
    { region: 'North', revenue: 50 },
  ],
}

const content = (viz: VizEnvelope): QuestionContent => ({
  query: 'SELECT 1',
  connection_name: 'static',
  vizSettings: { type: 'table', xCols: [], yCols: [] },
  viz,
}) as unknown as QuestionContent

const CONFIG = {
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
      config={CONFIG}
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

describe('QuestionVisualization — table envelope routing', () => {
  it('renders the real TableV2 (not the vega surface) for a table envelope', () => {
    renderViz(tableViz())
    // Real TableV2 bottom bar reports the row count; the vega marker must be absent.
    expect(screen.getByText('3 rows')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface')).not.toBeInTheDocument()
  })

  it('still routes vega-lite envelopes to the vega surface', async () => {
    renderViz(vegaViz)
    // findBy — the vega renderer is a next/dynamic lazy chunk
    expect(await screen.findByLabelText('Vega chart surface')).toBeInTheDocument()
    expect(screen.queryByText('3 rows')).not.toBeInTheDocument()
  })

  it('applies envelope columnFormats (alias shows in the header)', () => {
    renderViz(tableViz({ columnFormats: { revenue: { alias: 'Revenue ($)' } } }))
    expect(screen.getByLabelText('Column header Revenue ($)')).toBeInTheDocument()
  })

  it('writes header format edits back into the envelope via onVizChange', async () => {
    const user = userEvent.setup()
    const onVizChange = renderViz(tableViz())

    await user.click(screen.getByLabelText('Format column revenue'))
    await user.type(screen.getByLabelText('Alias for revenue'), 'Rev')

    expect(onVizChange).toHaveBeenCalled()
    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { kind: string; columnFormats: Record<string, { alias?: string }> }
    expect(source.kind).toBe('table')
    expect(source.columnFormats.revenue.alias).toBeTruthy()
  })

  it('injects the css override scoped to this table instance', () => {
    renderViz(tableViz({ css: '.mx-th { background: rgb(1, 2, 3); }' }))
    const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent ?? '')
    const scoped = styles.find(s => s.includes('.mx-th'))
    expect(scoped).toBeTruthy()
    // Scoped under a container class (CSS nesting) — never a global rule.
    expect(scoped!.trim().startsWith('.mx-th')).toBe(false)
  })

  it('exposes the stable class contract on the table DOM', () => {
    renderViz(tableViz())
    expect(document.querySelector('.mx-table')).toBeTruthy()
    expect(document.querySelector('.mx-header-row')).toBeTruthy()
    expect(document.querySelector('.mx-th')).toBeTruthy()
    expect(document.querySelector('.mx-row')).toBeTruthy()
    expect(document.querySelector('.mx-cell')).toBeTruthy()
    expect(document.querySelector('.mx-col-revenue')).toBeTruthy()
    expect(document.querySelector('.mx-toolbar')).toBeTruthy()
  })
})

// ─── VegaVizPanel — table state ──────────────────────────────────────────────

describe('VegaVizPanel — table envelope', () => {
  function renderPanel(viz: VizEnvelope, onVizChange = vi.fn()) {
    renderWithProviders(
      <VegaVizPanel envelope={viz} columns={DATA.columns} types={DATA.types} onVizChange={onVizChange} />
    )
    return onVizChange
  }

  it('Table icon is enabled and selected; no CUSTOM badge', () => {
    renderPanel(tableViz())
    const icon = screen.getByLabelText('Table')
    expect(icon).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByLabelText('Custom spec indicator')).not.toBeInTheDocument()
  })

  it('switching bar → table via the icon produces a table source', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel(vegaViz)
    await user.click(screen.getByLabelText('Table'))
    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    expect((next.source as unknown as { kind: string }).kind).toBe('table')
  })

  it('Fields tab explains columns are managed on the table itself', () => {
    renderPanel(tableViz())
    expect(screen.getByLabelText('Table fields hint')).toBeInTheDocument()
  })

  it('Settings tab hosts conditional formatting and the CSS override editor', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel(tableViz())
    await user.click(screen.getByLabelText('Settings tab'))

    expect(screen.getByLabelText('Add conditional formatting rule')).toBeInTheDocument()

    const cssEditor = screen.getByLabelText('Table CSS overrides')
    await user.click(cssEditor)
    await user.type(cssEditor, '.mx-th {{ font-size: 14px; }')
    await user.tab() // commit on blur

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    expect((next.source as unknown as { css: string }).css).toContain('.mx-th')
  })
})
