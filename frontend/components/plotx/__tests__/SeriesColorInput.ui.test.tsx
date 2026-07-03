import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import { SeriesColorInput } from '@/components/plotx/StyleConfigPopover'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const renderInput = (onCommit: (hex: string) => void, value = '#000000') =>
  renderWithProviders(
    <SeriesColorInput label="Series 1 color" value={value} onCommit={onCommit} />,
  )

describe('SeriesColorInput', () => {
  it('debounces the commit by 200ms, coalescing a rapid drag into one commit with the latest value', () => {
    const onCommit = vi.fn()
    const { getByLabelText } = renderInput(onCommit)
    const input = getByLabelText('Series 1 color input') as HTMLInputElement

    fireEvent.input(input, { target: { value: '#111111' } })
    fireEvent.input(input, { target: { value: '#222222' } })

    // Nothing committed until the debounce window elapses.
    expect(onCommit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('#222222')
  })
})
