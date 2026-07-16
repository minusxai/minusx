import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { makeStore } from '@/store/store'
import { setVizV2 } from '@/store/uiSlice'
import { QuestionVisualization } from '@/components/question/QuestionVisualization'
import { VegaVizPanel } from '@/components/viz/VegaVizPanel'
import type { VizEnvelope, PivotConfig } from '@/lib/validation/atlas-schemas'
import type { QuestionContent, QueryResult } from '@/lib/types'

// Every case in this file exercises V2 behavior — render with the engine ON.
const renderV2 = (ui: React.ReactElement) => {
  const store = makeStore()
  store.dispatch(setVizV2(true))
  return renderWithProviders(ui, { store })
}

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
  renderV2(
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
    renderV2(
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

  it('zone-chip gear edits column alias into the envelope columnFormats', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel(pivotViz())

    await user.click(screen.getByLabelText('Format column revenue'))
    await user.type(screen.getByLabelText('Alias for revenue'), 'Rev')

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { columnFormats: Record<string, { alias?: string }> }
    expect(source.columnFormats.revenue.alias).toBeTruthy()
  })

  it('V2 pivot gear speaks d3: preset click stores a format string', async () => {
    const user = userEvent.setup()
    const onVizChange = renderPanel(pivotViz())

    await user.click(screen.getByLabelText('Format column revenue'))
    await user.click(await screen.findByLabelText('Format $1,234'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { columnFormats: Record<string, { format?: string }> }
    expect(source.columnFormats.revenue.format).toBe('$,.0f')
  })

  it('pivot cells render a d3 format from the envelope', () => {
    renderViz(pivotViz({ columnFormats: { revenue: { format: '$,.0f' } } }))
    // West/Jan = 100 → $100 (heatmap cell)
    expect(screen.getAllByText('$100').length).toBeGreaterThan(0)
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

// ─── VegaVizPanel — recipe zone-chip formats ─────────────────────────────────

describe('VegaVizPanel — recipe column formats', () => {
  const waterfallViz: VizEnvelope = {
    version: 2,
    source: { kind: 'recipe', recipe: 'minusx/waterfall@1', bindings: { category: 'region', value: 'revenue' }, params: null, columnFormats: null },
  } as unknown as VizEnvelope

  it('recipe zone chips use the SAME d3 popover as native charts; alias edits land in columnFormats', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderV2(
      <VegaVizPanel envelope={waterfallViz} columns={DATA.columns} types={DATA.types} onVizChange={onVizChange} />
    )

    // The recipe slot is 'value' — one unified gear + popover across the vega tier.
    await user.click(screen.getByLabelText('Field settings for revenue'))
    await user.type(await screen.findByLabelText('Alias for revenue'), 'Rev{Enter}')

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { kind: string; columnFormats: Record<string, { alias?: string }> }
    expect(source.kind).toBe('recipe')
    expect(source.columnFormats.revenue.alias).toBe('Rev')
  })

  it('recipe format presets store a d3 format string in columnFormats', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderV2(
      <VegaVizPanel envelope={waterfallViz} columns={DATA.columns} types={DATA.types} onVizChange={onVizChange} />
    )

    await user.click(screen.getByLabelText('Field settings for revenue'))
    await user.click(await screen.findByLabelText('Format $1,234'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { columnFormats: Record<string, { format?: string }> }
    expect(source.columnFormats.revenue.format).toBe('$,.0f')
  })
})

// ─── Unified grid: pivot speaks the same contract as the flat table ──────────

describe('Pivot on the unified grid', () => {
  it('renders the shared class contract: .mx-table root, .mx-th headers, zebra data rows', () => {
    renderViz(pivotViz())
    const root = document.querySelector('.mx-pivot')
    expect(root).toBeTruthy()
    expect(root!.classList.contains('mx-table')).toBe(true)
    expect(document.querySelectorAll('.mx-pivot .mx-th').length).toBeGreaterThan(0)
    const dataRows = Array.from(document.querySelectorAll('.mx-pivot tbody tr.mx-row'))
    expect(dataRows.length).toBeGreaterThan(0)
    expect(dataRows[0].classList.contains('mx-row-even')).toBe(true)
    expect(dataRows[1].classList.contains('mx-row-odd')).toBe(true)
  })

  it('colour-scale rule paints value cells along the ramp (heatmap off)', () => {
    renderViz(pivotViz({
      config: { ...CONFIG, showHeatmap: false },
      conditionalFormats: [{ id: 's1', column: 'revenue', scale: 'blue' }],
    }))
    const cells = Array.from(document.querySelectorAll('.mx-pivot td.mx-col-revenue')) as HTMLElement[]
    expect(cells.length).toBeGreaterThan(0)
    const painted = cells.filter(c => c.style.backgroundColor.startsWith('rgba('))
    expect(painted.length).toBeGreaterThan(0)
  })

  it('condition rule paints matching value cells (heatmap off)', () => {
    renderViz(pivotViz({
      config: { ...CONFIG, showHeatmap: false },
      conditionalFormats: [
        { id: 'c1', column: 'revenue', operator: '>', value: '150', target: 'cell', bgColor: '#123456' },
      ],
    }))
    const cells = Array.from(document.querySelectorAll('.mx-pivot td.mx-col-revenue')) as HTMLElement[]
    // Only East/Jan = 200 exceeds 150
    const painted = cells.filter(c => c.style.backgroundColor === 'rgb(18, 52, 86)')
    expect(painted.length).toBe(1)
  })

  it('shares the grid toolbar: row count + CSV download', () => {
    renderViz(pivotViz())
    expect(screen.getByLabelText('Download CSV')).toBeInTheDocument()
  })

  it('Settings tab hosts conditional formatting for pivot sources', async () => {
    const user = userEvent.setup()
    const onVizChange = vi.fn()
    renderV2(
      <VegaVizPanel envelope={pivotViz()} columns={DATA.columns} types={DATA.types} onVizChange={onVizChange} />
    )
    await user.click(screen.getByLabelText('Settings tab'))
    await user.click(screen.getByLabelText('Add color scale rule'))

    const next = onVizChange.mock.calls.at(-1)![0] as VizEnvelope
    const source = next.source as unknown as { conditionalFormats: Array<Record<string, unknown>> }
    expect(source.conditionalFormats).toHaveLength(1)
    expect(source.conditionalFormats[0].scale).toBe('red-yellow-green')
  })
})

// ─── V2 panel owns the tabs: no nested Fields/Settings inside PivotAxisBuilder ─

describe('VegaVizPanel — pivot sections ride the panel tabs', () => {
  function renderPanel(viz: VizEnvelope) {
    renderV2(
      <VegaVizPanel envelope={viz} columns={DATA.columns} types={DATA.types} onVizChange={vi.fn()} />
    )
  }

  it('Fields tab shows zones WITHOUT the builder-internal tab bar or options', () => {
    renderPanel(pivotViz())
    expect(screen.queryByLabelText('Pivot fields section')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Pivot settings section')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Toggle row totals')).not.toBeInTheDocument()
  })

  it('Settings tab hosts the pivot options (totals/heatmap) beside conditional formats', async () => {
    const user = userEvent.setup()
    renderPanel(pivotViz())
    await user.click(screen.getByLabelText('Settings tab'))
    expect(screen.getByLabelText('Toggle row totals')).toBeInTheDocument()
    expect(screen.getByLabelText('Toggle column totals')).toBeInTheDocument()
    expect(screen.getByLabelText('Toggle heatmap')).toBeInTheDocument()
    expect(screen.getByLabelText('Add color scale rule')).toBeInTheDocument()
  })

  it('classic surfaces keep the internal Fields/Settings tabs', async () => {
    const { PivotAxisBuilder } = await import('@/components/plotx/PivotAxisBuilder')
    renderV2(
      <PivotAxisBuilder
        columns={DATA.columns}
        types={DATA.types}
        pivotConfig={CONFIG}
        onPivotConfigChange={vi.fn()}
        columnFormats={{}}
        onColumnFormatChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Pivot fields section')).toBeInTheDocument()
    expect(screen.getByLabelText('Pivot settings section')).toBeInTheDocument()
  })
})

describe('VegaVizPanel — pivot formulas in V2', () => {
  it('Settings tab offers the Formulas builder when dimensions have ≥2 values', async () => {
    const user = userEvent.setup()
    renderV2(
      <VegaVizPanel
        envelope={pivotViz()}
        columns={DATA.columns}
        types={DATA.types}
        rows={DATA.rows}
        onVizChange={vi.fn()}
      />
    )
    await user.click(screen.getByLabelText('Settings tab'))
    // The Formulas settings card renders (collapse control carries the card title)
    expect(screen.getByLabelText('Collapse Formulas')).toBeInTheDocument()
  })

  it('without rows the Formulas card is absent (no values to build from)', async () => {
    const user = userEvent.setup()
    renderV2(
      <VegaVizPanel envelope={pivotViz()} columns={DATA.columns} types={DATA.types} onVizChange={vi.fn()} />
    )
    await user.click(screen.getByLabelText('Settings tab'))
    expect(screen.queryByLabelText('Collapse Formulas')).not.toBeInTheDocument()
  })
})
