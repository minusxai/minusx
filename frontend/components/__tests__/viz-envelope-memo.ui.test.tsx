/**
 * Vega envelope memoization (Renderer_v2 Phase 7, §1.3 lever 2): VegaChart's build effect is
 * keyed on envelope IDENTITY — a parent that reconstructs the envelope object every render
 * forces a full Vega view rebuild (finalize + re-parse + re-render) on every unrelated
 * re-render. QuestionVisualization's legacy bridge (`resolveLegacyRenderEnvelope`) must
 * therefore be memoized: same vizSettings + same data → same envelope reference.
 */
import React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { makeStore } from '@/store/store'
import { QuestionVisualization } from '@/components/question/QuestionVisualization'
import type { QuestionContent, QueryResult } from '@/lib/types'

const { envelopes } = vi.hoisted(() => ({ envelopes: [] as unknown[] }))
vi.mock('@/components/viz/VegaChart', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({ envelope }: { envelope: unknown }) => {
      envelopes.push(envelope)
      return React.createElement('div', { 'aria-label': 'Vega chart surface' })
    },
  }
})
vi.mock('@/lib/hooks/useConfigs', () => ({
  useConfigs: () => ({ config: { branding: { agentName: 'Agent' } }, configs: [], loading: false, error: null, reloadConfigs: vi.fn() }),
}))

const DATA: QueryResult = {
  columns: ['month', 'revenue'],
  types: ['VARCHAR', 'DOUBLE'],
  rows: [
    { month: 'Jan', revenue: 100 },
    { month: 'Feb', revenue: 150 },
  ],
}

const content = (): QuestionContent => ({
  query: 'SELECT 1',
  connection_name: 'static',
  vizSettings: { type: 'line', xCols: ['month'], yCols: ['revenue'] },
}) as unknown as QuestionContent

const CONFIG_UI = {
  showHeader: false,
  showJsonToggle: false,
  editable: true,
  viz: { showTypeButtons: false, showChartBuilder: false, typesButtonsOrientation: 'horizontal' as const, showTitle: false },
  fixError: false,
}

describe('legacy envelope identity across re-renders', () => {
  it('re-rendering with unchanged vizSettings/data keeps ONE envelope reference (no Vega rebuild)', async () => {
    envelopes.length = 0
    const store = makeStore()
    const stableContent = content()
    const props = {
      currentState: stableContent,
      config: CONFIG_UI,
      loading: false,
      error: null as string | null,
      data: DATA,
      onVizTypeChange: vi.fn(),
      onAxisChange: vi.fn(),
      onVizChange: vi.fn(),
    }
    const { rerender } = renderWithProviders(<QuestionVisualization {...props} />, { store })
    // VegaChart is a next/dynamic lazy chunk — wait for the (mocked) chart to mount first.
    await screen.findByLabelText('Vega chart surface')
    // Changed-callback renders get PAST the memo comparator (it deliberately doesn't ignore
    // callbacks) — the inner component re-runs, and without memoization it would mint a new
    // envelope object each time, forcing a full Vega view rebuild mid-interaction.
    rerender(<QuestionVisualization {...props} onVizTypeChange={vi.fn()} />)
    rerender(<QuestionVisualization {...props} onVizTypeChange={vi.fn()} />)

    expect(envelopes.length).toBeGreaterThanOrEqual(3)
    expect(new Set(envelopes).size).toBe(1)
  })
})
