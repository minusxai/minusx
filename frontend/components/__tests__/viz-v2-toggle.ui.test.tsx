import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { QuestionVisualization } from '@/components/question/QuestionVisualization'
import QuestionViewV2 from '@/components/views/QuestionViewV2'
import { makeStore } from '@/store/store'
import { setVizV2 } from '@/store/uiSlice'
import type { VizEnvelope } from '@/lib/validation/atlas-schemas'
import type { QuestionContent, QueryResult } from '@/lib/types'

// ─── Mocks: heavy renderers not under test — markers prove routing ───────────

vi.mock('@/components/viz/VegaChart', () => ({
  default: () => <div aria-label="Vega chart surface" />,
}))
vi.mock('@/components/plotx/ChartBuilder', () => ({
  ChartBuilder: () => <div aria-label="Classic chart builder" />,
}))
vi.mock('@/components/viz/VegaVizPanel', () => ({
  VegaVizPanel: () => <div aria-label="Vega viz panel" />,
}))
vi.mock('@/components/plotx/VizConfigPanel', () => ({
  VizConfigPanel: () => <div aria-label="Classic viz config panel" />,
}))
vi.mock('@/components/query-builder/SqlEditor', () => ({
  default: () => <div aria-label="SQL editor surface" />,
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
vi.mock('@/lib/hooks/useContext', () => ({
  useContext: () => ({
    contextId: undefined,
    databases: [],
    contextDocs: undefined,
    skills: [],
    availableSkills: [],
    hasContext: false,
    contextLoading: false,
  }),
}))
vi.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: {
      static: {
        metadata: { name: 'static', type: 'duckdb', config: {}, created_at: '', updated_at: '' },
        schema: null,
        schemaLoadedAt: undefined,
        schemaError: undefined,
      },
    },
    loading: false,
    error: null,
  }),
}))
vi.mock('@/lib/hooks/useAvailableQuestions', () => ({
  useAvailableQuestions: () => ({ questions: [], loading: false }),
}))
vi.mock('@/lib/hooks/use-gui-compat', () => ({
  useGuiCompat: () => ({ canUseGUI: true, guiError: null }),
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DATA: QueryResult = {
  columns: ['month', 'revenue'],
  types: ['VARCHAR', 'DOUBLE'],
  rows: [
    ['Jan', 10],
    ['Feb', 20],
    ['Mar', 30],
  ],
} as unknown as QueryResult

/** A legacy chart question: vizSettings only, NO `viz` envelope. */
const legacyLineContent = {
  query: 'SELECT 1',
  connection_name: 'static',
  vizSettings: { type: 'line', xCols: ['month'], yCols: ['revenue'] },
} as unknown as QuestionContent

/** A question saved with a V2 envelope (plus legacy vizSettings for the V1 path). */
const envelopeContent = {
  query: 'SELECT 1',
  connection_name: 'static',
  vizSettings: { type: 'line', xCols: ['month'], yCols: ['revenue'] },
  viz: {
    version: 2,
    source: {
      kind: 'vega-lite',
      grammar: 'vega-lite/v6',
      spec: {
        mark: { type: 'line' },
        encoding: {
          x: { field: 'month', type: 'nominal' },
          y: { field: 'revenue', type: 'quantitative', aggregate: 'sum' },
        },
      },
    },
  } as unknown as VizEnvelope,
} as unknown as QuestionContent

const CONFIG = {
  showHeader: false,
  showJsonToggle: false,
  editable: true,
  viz: { showTypeButtons: false, showChartBuilder: false, typesButtonsOrientation: 'horizontal' as const, showTitle: false },
  fixError: false,
}

function renderQuestion(content: QuestionContent, { vizV2 }: { vizV2: boolean }) {
  const store = makeStore()
  store.dispatch(setVizV2(vizV2))
  renderWithProviders(
    <QuestionVisualization
      currentState={content}
      config={CONFIG}
      loading={false}
      error={null}
      data={DATA}
      onVizTypeChange={vi.fn()}
      onAxisChange={vi.fn()}
      onVizChange={vi.fn()}
    />,
    { store },
  )
}

// ─── Viz V2 toggle (docs/Visualization Arch V2.md §21) ───────────────────────
//
// The uiSlice `vizV2` flag decides the rendering engine WHOLESALE. OFF: the
// classic V1 pipeline (vizSettings/ECharts) renders everything — even a saved
// `viz` envelope is ignored, so the app behaves exactly like pre-V2. ON: the
// V2 engine renders everything — the saved envelope when present, else the
// V1→V2 converter bridge.

describe('vizV2 default', () => {
  it('the V2 engine is ON by default (rendering flip — files/prompts stay V1)', () => {
    expect(makeStore().getState().ui.vizV2).toBe(true)
  })
})

describe('QuestionVisualization — vizV2 toggle decides the engine', () => {
  it('toggle OFF: a legacy chart renders the classic ECharts builder, not vega', () => {
    renderQuestion(legacyLineContent, { vizV2: false })
    expect(screen.getByLabelText('Classic chart builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface')).not.toBeInTheDocument()
  })

  it('toggle ON: the same legacy chart renders through the vega bridge', async () => {
    renderQuestion(legacyLineContent, { vizV2: true })
    expect(await screen.findByLabelText('Vega chart surface')).toBeInTheDocument()
    expect(screen.queryByLabelText('Classic chart builder')).not.toBeInTheDocument()
  })

  it('toggle OFF: even a saved V2 envelope renders through the classic V1 path', () => {
    renderQuestion(envelopeContent, { vizV2: false })
    expect(screen.getByLabelText('Classic chart builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface')).not.toBeInTheDocument()
  })

  it('toggle ON: a saved V2 envelope renders through vega', async () => {
    renderQuestion(envelopeContent, { vizV2: true })
    expect(await screen.findByLabelText('Vega chart surface')).toBeInTheDocument()
    expect(screen.queryByLabelText('Classic chart builder')).not.toBeInTheDocument()
  })
})

// ─── QuestionViewV2 panel gate ───────────────────────────────────────────────
//
// The view is Redux-free (RESTRICT_VIEW_REDUX): the flag arrives as the
// `vizV2Enabled` prop, sourced from the selector in its containers. With the
// flag off, the Viz tab shows the classic config panel for EVERY question
// (envelope or not) — byte-for-byte main behavior; with it on, the saved or
// converted envelope opens in the V2 Vega panel (first edit writes a real
// `viz` onto the content).

function renderView(content: QuestionContent, { vizV2Enabled }: { vizV2Enabled: boolean }) {
  renderWithProviders(
    <QuestionViewV2
      viewMode="toolcall" // compact layout — jsdom has no width, and only compact keeps the Viz tab
      content={content}
      queryData={DATA}
      queryLoading={false}
      queryError={null}
      queryStale={false}
      collapsedPanel="none"
      onTogglePanel={vi.fn()}
      fileState={{}}
      onSetFile={vi.fn()}
      onChange={vi.fn()}
      onExecute={vi.fn()}
      vizV2Enabled={vizV2Enabled}
    />,
  )
}

describe('QuestionViewV2 — vizV2Enabled prop gates the V2 editing panel', () => {
  it('prop OFF: the Viz tab of a legacy chart shows the classic config panel', async () => {
    renderView(legacyLineContent, { vizV2Enabled: false })
    await userEvent.click(screen.getByLabelText('Viz'))
    expect(await screen.findByLabelText('Classic viz config panel')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega viz panel')).not.toBeInTheDocument()
  })

  it('prop ON: the same legacy chart edits its converted envelope in the Vega panel', async () => {
    renderView(legacyLineContent, { vizV2Enabled: true })
    await userEvent.click(screen.getByLabelText('Viz'))
    expect(await screen.findByLabelText('Vega viz panel')).toBeInTheDocument()
    expect(screen.queryByLabelText('Classic viz config panel')).not.toBeInTheDocument()
  })

  it('prop OFF: even a saved V2 envelope edits in the classic config panel', async () => {
    renderView(envelopeContent, { vizV2Enabled: false })
    await userEvent.click(screen.getByLabelText('Viz'))
    expect(await screen.findByLabelText('Classic viz config panel')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega viz panel')).not.toBeInTheDocument()
  })

  it('prop ON: a saved V2 envelope edits in the Vega panel', async () => {
    renderView(envelopeContent, { vizV2Enabled: true })
    await userEvent.click(screen.getByLabelText('Viz'))
    expect(await screen.findByLabelText('Vega viz panel')).toBeInTheDocument()
  })
})

// Wide layout (viewMode='page', jsdom width 0 → not compact): the right-hand
// VizPanel column must follow the same flag — V2 panel (with the V2 type grid)
// when on, classic config when off.
describe('QuestionViewV2 — wide-layout right panel follows the flag', () => {
  function renderWideView(content: QuestionContent, { vizV2Enabled }: { vizV2Enabled: boolean }) {
    renderWithProviders(
      <QuestionViewV2
        viewMode="page"
        content={content}
        queryData={DATA}
        queryLoading={false}
        queryError={null}
        queryStale={false}
        collapsedPanel="none"
        onTogglePanel={vi.fn()}
        fileState={{}}
        onSetFile={vi.fn()}
        onChange={vi.fn()}
        onExecute={vi.fn()}
        vizV2Enabled={vizV2Enabled}
      />,
    )
  }

  it('flag ON: the right column hosts the Vega viz panel (V2 type grid)', async () => {
    renderWideView(legacyLineContent, { vizV2Enabled: true })
    expect(await screen.findByLabelText('Vega viz panel')).toBeInTheDocument()
    expect(screen.queryByLabelText('Classic viz config panel')).not.toBeInTheDocument()
  })

  it('flag OFF: the right column keeps the classic config panel', async () => {
    renderWideView(legacyLineContent, { vizV2Enabled: false })
    expect(await screen.findByLabelText('Classic viz config panel')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega viz panel')).not.toBeInTheDocument()
  })

  it('flag ON: a saved envelope also edits in the right-column Vega panel', async () => {
    renderWideView(envelopeContent, { vizV2Enabled: true })
    expect(await screen.findByLabelText('Vega viz panel')).toBeInTheDocument()
  })

  it('flag ON: a SEMANTIC question keeps the classic panel (inference/type-lock own vizSettings)', async () => {
    const semanticContent = {
      ...legacyLineContent,
      semanticQuery: { table: 'orders', dimensions: [], measures: [] },
    } as unknown as QuestionContent
    renderWideView(semanticContent, { vizV2Enabled: true })
    expect(await screen.findByLabelText('Classic viz config panel')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega viz panel')).not.toBeInTheDocument()
  })
})
