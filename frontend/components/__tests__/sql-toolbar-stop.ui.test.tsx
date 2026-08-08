/**
 * The Run button becomes a STOP button while the query executes: a running
 * query must be cancellable from the same control that started it. Without an
 * onStop handler the legacy disabled-spinner rendering stays (embed surfaces
 * that cannot cancel).
 */
import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import SqlEditorToolbar from '@/components/query-builder/SqlEditorToolbar'

const BASE = {
  readOnly: false,
  showFormatButton: false,
  showRunButton: true,
  onFormat: () => {},
}

describe('SqlEditorToolbar stop button', () => {
  it('idle: shows Run and fires onRun', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn()
    renderWithProviders(<SqlEditorToolbar {...BASE} onRun={onRun} isRunning={false} onStop={vi.fn()} />)
    await user.click(screen.getByLabelText('Run query'))
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Stop query')).toBeNull()
  })

  it('running with onStop: the control becomes Stop and fires onStop', async () => {
    const user = userEvent.setup()
    const onRun = vi.fn()
    const onStop = vi.fn()
    renderWithProviders(<SqlEditorToolbar {...BASE} onRun={onRun} isRunning onStop={onStop} />)
    expect(screen.queryByLabelText('Run query')).toBeNull()
    await user.click(screen.getByLabelText('Stop query'))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onRun).not.toHaveBeenCalled()
  })

  it('running without onStop: legacy disabled spinner (no Stop control)', () => {
    renderWithProviders(<SqlEditorToolbar {...BASE} onRun={vi.fn()} isRunning />)
    expect(screen.queryByLabelText('Stop query')).toBeNull()
    expect((screen.getByLabelText('Run query') as HTMLButtonElement).disabled).toBe(true)
  })
})
