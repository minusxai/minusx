import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { QuestionVisualization } from '@/components/question/QuestionVisualization'
import QuestionViewV2 from '@/components/views/QuestionViewV2'
import { makeStore } from '@/store/store'
import { setVizV2, setVizRenderer } from '@/store/uiSlice'
import type { VizEnvelope } from '@/lib/validation/atlas-schemas'
import type { QuestionContent, QueryResult } from '@/lib/types'

// ─── Mocks: heavy renderers not under test — markers prove routing ───────────

// The marker exposes the envelope's source kind so tests can tell a directly-
// rendered saved envelope (kind 'recipe' below) from a just-in-time conversion
// of vizSettings (kind 'vega-lite').
vi.mock('@/components/viz/VegaChart', () => ({
  default: ({ envelope }: { envelope?: { source?: unknown } }) => (
    <div aria-label={`Vega chart surface ${((envelope?.source as { kind?: string })?.kind) ?? 'unknown'}`} />
  ),
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

/** A question saved with a V2 envelope (a RECIPE, distinguishable from the
 * vega-lite output of the JIT converter) plus legacy vizSettings. */
const envelopeContent = {
  query: 'SELECT 1',
  connection_name: 'static',
  vizSettings: { type: 'line', xCols: ['month'], yCols: ['revenue'] },
  viz: {
    version: 2,
    source: {
      kind: 'recipe',
      recipe: 'minusx/funnel@1',
      bindings: { stage: 'month', value: 'revenue' },
      params: null,
      columnFormats: null,
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

function renderQuestion(content: QuestionContent, { vizV2, renderer = 'vega' }: { vizV2: boolean; renderer?: 'echarts' | 'vega' }) {
  const store = makeStore()
  store.dispatch(setVizV2(vizV2))
  store.dispatch(setVizRenderer(renderer))
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
// Vega draws EVERY chart — ECharts no longer renders. The uiSlice `vizV2` flag
// picks the AUTHORITATIVE viz format: OFF (V1, the default until prompts/tools
// flip) → `vizSettings` is the truth; charts are just-in-time converted for
// rendering and saved `viz` envelopes are ignored. ON (V2) → a saved envelope
// is the truth and renders directly (legacy files still convert JIT).

describe('viz toggles — defaults', () => {
  it('V1 (vizSettings) is the authoritative format by default — flips with the prompts/tools PR', () => {
    expect(makeStore().getState().ui.vizV2).toBe(false)
  })

  it('vega is the default renderer; echarts is the classic escape hatch', () => {
    expect(makeStore().getState().ui.vizRenderer).toBe('vega')
  })
})

// ─── Renderer toggle: echarts = the exact pre-V2 app ─────────────────────────
//
// When the renderer is 'echarts', only V1 is possible: vizSettings drive the
// classic ECharts pipeline, saved `viz` envelopes are ignored, and the vizV2
// format flag has no effect.

describe('QuestionVisualization — renderer=echarts forces the classic V1 pipeline', () => {
  it('a legacy chart renders the classic ECharts builder, no vega', () => {
    renderQuestion(legacyLineContent, { vizV2: false, renderer: 'echarts' })
    expect(screen.getByLabelText('Classic chart builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface vega-lite')).not.toBeInTheDocument()
  })

  it('even with vizV2 ON and a saved envelope, echarts renders from vizSettings', () => {
    renderQuestion(envelopeContent, { vizV2: true, renderer: 'echarts' })
    expect(screen.getByLabelText('Classic chart builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface recipe')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface vega-lite')).not.toBeInTheDocument()
  })
})

describe('QuestionVisualization — vega always draws; the toggle picks the authoritative format', () => {
  it('toggle V1: a legacy chart renders through vega via JIT conversion (not ECharts)', async () => {
    renderQuestion(legacyLineContent, { vizV2: false })
    expect(await screen.findByLabelText('Vega chart surface vega-lite')).toBeInTheDocument()
    expect(screen.queryByLabelText('Classic chart builder')).not.toBeInTheDocument()
  })

  it('toggle V1: a saved envelope is IGNORED — vega renders the JIT conversion of vizSettings', async () => {
    renderQuestion(envelopeContent, { vizV2: false })
    expect(await screen.findByLabelText('Vega chart surface vega-lite')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface recipe')).not.toBeInTheDocument()
  })

  it('toggle V2: the saved envelope renders directly', async () => {
    renderQuestion(envelopeContent, { vizV2: true })
    expect(await screen.findByLabelText('Vega chart surface recipe')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vega chart surface vega-lite')).not.toBeInTheDocument()
  })

  it('toggle V2: a legacy chart still renders via JIT conversion', async () => {
    renderQuestion(legacyLineContent, { vizV2: true })
    expect(await screen.findByLabelText('Vega chart surface vega-lite')).toBeInTheDocument()
    expect(screen.queryByLabelText('Classic chart builder')).not.toBeInTheDocument()
  })
})

// ─── QuestionViewV2 panel gate ───────────────────────────────────────────────
//
// The view is Redux-free (RESTRICT_VIEW_REDUX): the flag arrives as the
// `vizV2Enabled` prop, sourced from the selector in its containers.
// V1 mode (flag off): classic panel for everything — the converter never
// feeds the editor, nothing ever writes an envelope. V2 mode (flag on): the
// V2 Vega panel edits the saved envelope, or — for a vizSettings-only chart —
// its JIT-converted envelope, and the first edit writes a real `viz` onto the
// content (the file upgrades on Save). Semantic questions are the exception:
// type inference owns vizSettings, so they keep the classic panel.

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

  it('prop ON: a legacy chart edits its JIT-converted envelope in the Vega panel', async () => {
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

  it('flag ON: a legacy chart gets the Vega viz panel in the right column (JIT envelope)', async () => {
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
