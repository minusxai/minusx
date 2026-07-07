import React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer'
import type { QuestionContent } from '@/lib/types'

// Isolate the container: the file is "loaded" and EmbeddedQuestionContainer is replaced with a
// probe that exposes the vizSettings it receives — the subject here is the style cascade
// (chartTheme < question < embedStyles) and the memo comparator, not query execution.
const QUESTION_CONTENT: QuestionContent = {
  description: null,
  query: 'SELECT 1 AS n',
  connection_name: 'duckdb',
  vizSettings: { type: 'bar', xCols: ['n'], yCols: ['n'], styleConfig: { stacked: false } },
  parameters: [],
}

vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFile: () => ({ fileState: { id: 7, name: 'Revenue', loading: false } }),
}))

vi.mock('@/store/filesSlice', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    selectMergedContent: () => QUESTION_CONTENT,
    selectEffectiveName: () => 'Revenue',
  }
})

vi.mock('@/lib/hooks/useExplainQuestion', () => ({
  useExplainQuestion: () => ({ explainQuestion: vi.fn() }),
}))

vi.mock('@/components/containers/EmbeddedQuestionContainer', () => ({
  default: ({ question }: { question: QuestionContent }) => (
    <div aria-label="Embedded viz probe">{JSON.stringify(question.vizSettings)}</div>
  ),
}))

const probeSettings = () => JSON.parse(screen.getByLabelText('Embedded viz probe').textContent ?? '{}')

describe('SmartEmbeddedQuestionContainer — story style cascade', () => {
  it('renders the question untouched without theme/styles', async () => {
    renderWithProviders(<SmartEmbeddedQuestionContainer questionId={7} />)
    expect(await screen.findByLabelText('Embedded viz probe')).toBeInTheDocument()
    expect(probeSettings()).toEqual(QUESTION_CONTENT.vizSettings)
  })

  it('merges chartTheme beneath and embedStyles above the question settings', async () => {
    renderWithProviders(
      <SmartEmbeddedQuestionContainer
        questionId={7}
        chartTheme={{ background: '#fdfaf3', textColor: '#2b2b2b' }}
        embedStyles={{ styleConfig: { background: '#101822' } }}
      />
    )
    await screen.findByLabelText('Embedded viz probe')
    const viz = probeSettings()
    expect(viz.styleConfig.background).toBe('#101822')  // embed beats theme
    expect(viz.styleConfig.textColor).toBe('#2b2b2b')   // theme default survives
    expect(viz.styleConfig.stacked).toBe(false)          // question value survives
    expect(viz.type).toBe('bar')
  })

  it('re-renders when only embedStyles changes (memo comparator must not swallow it)', async () => {
    const { rerender } = renderWithProviders(
      <SmartEmbeddedQuestionContainer questionId={7} embedStyles={{ styleConfig: { background: '#101822' } }} />
    )
    await screen.findByLabelText('Embedded viz probe')
    expect(probeSettings().styleConfig.background).toBe('#101822')
    rerender(
      <SmartEmbeddedQuestionContainer questionId={7} embedStyles={{ styleConfig: { background: '#204060' } }} />
    )
    expect(probeSettings().styleConfig.background).toBe('#204060')
  })
})
