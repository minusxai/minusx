/**
 * The recipe file viewer's EDIT story: in edit mode the description and the
 * template JSON are directly editable (committed on blur through the same
 * validated full-replace path as the File tab), an invalid template shows the
 * validation error inline, and read mode stays read-only.
 */
import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import VizRecipeView from '@/components/views/VizRecipeView'
import type { VizRecipeContent } from '@/lib/validation/atlas-schemas'

const RECIPE: VizRecipeContent = {
  description: 'Simple bar',
  engine: 'vega-lite',
  bindings: [
    { name: 'category', label: 'Category', accepts: ['nominal'] },
    { name: 'value', label: 'Value', accepts: ['quantitative'] },
  ],
  template: {
    mark: 'bar',
    encoding: {
      x: { field: '{{category}}', type: 'nominal' },
      y: { field: '{{value}}', type: 'quantitative' },
    },
  },
}

describe('VizRecipeView editing', () => {
  it('read mode has no editable controls', () => {
    renderWithProviders(<VizRecipeView content={RECIPE} colorMode="light" />)
    expect(screen.queryByLabelText('Recipe template editor')).toBeNull()
    expect(screen.queryByLabelText('Recipe description editor')).toBeNull()
  })

  it('edit mode commits the template on blur through the provided callback', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn().mockReturnValue({ success: true })
    renderWithProviders(
      <VizRecipeView content={RECIPE} colorMode="light" editable onCommitContent={onCommit} />,
    )
    const editor = screen.getByLabelText('Recipe template editor') as HTMLTextAreaElement
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.paste('{"mark": "line"}')
    await user.tab() // blur commits
    expect(onCommit).toHaveBeenCalledTimes(1)
    const committed = JSON.parse(onCommit.mock.calls[0][0])
    expect(committed.template).toEqual({ mark: 'line' })
    expect(committed.description).toBe('Simple bar') // rest of content preserved
  })

  it('an invalid template JSON shows the error inline and commits nothing', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    renderWithProviders(
      <VizRecipeView content={RECIPE} colorMode="light" editable onCommitContent={onCommit} />,
    )
    const editor = screen.getByLabelText('Recipe template editor')
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.paste('{not json')
    await user.tab()
    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Recipe editor error').textContent).toMatch(/JSON/i)
  })

  it('a commit rejected by validation surfaces the reason inline', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn().mockReturnValue({ success: false, error: 'unknown token "{{ghost}}"' })
    renderWithProviders(
      <VizRecipeView content={RECIPE} colorMode="light" editable onCommitContent={onCommit} />,
    )
    const editor = screen.getByLabelText('Recipe template editor')
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}')
    await user.paste('{"mark": "bar", "encoding": {"x": {"field": "{{ghost}}"}}}')
    await user.tab()
    expect(onCommit).toHaveBeenCalled()
    expect(screen.getByLabelText('Recipe editor error').textContent).toContain('ghost')
  })
})
