/**
 * Embed pre-result busy stamp (the "beautiful story gutted" incident, Jul 2026).
 *
 * An auto-running embed (headerless QuestionVisualization inside a story/dashboard) renders
 * NOTHING between mount and its first result: before the query effect fires — and in any other
 * phase where `loading` is momentarily false without data — the card is a blank box with NO
 * `data-mx-busy` marker. The capture readiness gate then sees a calm view, settles, and the
 * screenshot shows blank embeds; the LLM visual judge fails the story for "missing evidence"
 * and the agent deletes healthy embeds to satisfy it.
 *
 * Contract: a headerless embed WITH an executable source but NO result and NO error is BUSY —
 * from mount until data or error arrives. The workbench idle state (header shown, user hasn't
 * run) and a source-less embed (nothing will ever run — a genuine defect to capture) stay
 * unstamped.
 */
import React from 'react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { QuestionVisualization } from '@/components/question/QuestionVisualization'
import type { QuestionContent } from '@/lib/types'

vi.mock('@/components/viz/VegaChart', () => {
  const React = require('react')
  return { __esModule: true, default: () => React.createElement('div', { 'aria-label': 'Vega chart surface' }) }
})
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'Agent' } }, configs: [], loading: false, error: null, reloadConfigs: vi.fn() }),
}))

const content = (over: Partial<QuestionContent> = {}): QuestionContent => ({
  query: 'SELECT 1',
  connection_name: 'duck',
  vizSettings: { type: 'line', xCols: ['x'], yCols: ['y'] },
  ...over,
}) as unknown as QuestionContent

const EMBED_CONFIG = {
  showHeader: false,
  showJsonToggle: false,
  editable: false,
  viz: { showTypeButtons: false, showChartBuilder: false, typesButtonsOrientation: 'vertical' as const, showTitle: false },
  fixError: false,
  enableDrilldown: false,
}
const WORKBENCH_CONFIG = { ...EMBED_CONFIG, showHeader: true }

const busyEls = () => document.querySelectorAll('[data-mx-busy="true"]')

type VizProps = React.ComponentProps<typeof QuestionVisualization>

function mount(props: Partial<VizProps>) {
  const base: VizProps = {
    currentState: content(),
    config: EMBED_CONFIG,
    loading: false,
    error: null,
    data: null,
    onVizTypeChange: () => {},
    onAxisChange: () => {},
  }
  return renderWithProviders(<QuestionVisualization {...base} {...props} />)
}

describe('headerless embed pre-result state is BUSY (capture readiness)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('no result + no error + executable query → stamped busy', () => {
    mount({})
    expect(busyEls().length).toBeGreaterThan(0)
  })

  it('loading state stays stamped (existing spinner contract)', () => {
    mount({ loading: true })
    expect(busyEls().length).toBeGreaterThan(0)
  })

  it('an error is a SETTLED state — not busy (the agent must see real errors)', () => {
    mount({ error: 'boom' })
    expect(busyEls().length).toBe(0)
  })

  it('a source-less embed will never run — not busy (a genuine defect to capture)', () => {
    mount({ currentState: content({ query: '', connection_name: '' }) })
    expect(busyEls().length).toBe(0)
  })

  it('the workbench idle state (header, user has not run) — not busy', () => {
    mount({ config: WORKBENCH_CONFIG })
    expect(busyEls().length).toBe(0)
  })
})
