import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import GenericSelector from '@/components/selectors/GenericSelector'
import { LuDatabase } from 'react-icons/lu'

const OPTIONS = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta Corp' },
  { value: 'gamma', label: 'Gamma Inc' },
]

describe('GenericSelector compact mode', () => {
  it('shows placeholder when no option is selected, not the first option', () => {
    renderWithProviders(
      <GenericSelector
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
        compact
        compactLabel="Knowledge Base"
        placeholder="Select context"
        defaultIcon={LuDatabase}
        label="context-selector"
      />
    )

    // The displayed text should contain the placeholder, NOT the first option
    expect(screen.getByText(/Knowledge Base: Select context/)).toBeTruthy()
    // It should NOT show the first option as if it were selected
    expect(screen.queryByText(/Knowledge Base: Alpha/)).toBeNull()
  })

  it('shows selected option label when a valid value is provided', () => {
    renderWithProviders(
      <GenericSelector
        value="beta"
        onChange={vi.fn()}
        options={OPTIONS}
        compact
        compactLabel="Knowledge Base"
        placeholder="Select context"
        defaultIcon={LuDatabase}
        label="context-selector"
      />
    )

    expect(screen.getByText(/Knowledge Base: Beta Corp/)).toBeTruthy()
  })

  it('opens dropdown and calls onChange when an option is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <GenericSelector
        value=""
        onChange={onChange}
        options={OPTIONS}
        compact
        compactLabel="Knowledge Base"
        placeholder="Select context"
        defaultIcon={LuDatabase}
        label="context-selector"
      />
    )

    // Click the pill to open the menu
    await user.click(screen.getByLabelText('context-selector'))

    // All options should be visible in the dropdown
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta Corp')).toBeTruthy()
    expect(screen.getByText('Gamma Inc')).toBeTruthy()

    // Click an option
    await user.click(screen.getByText('Gamma Inc'))
    expect(onChange).toHaveBeenCalledWith('gamma')
  })
})
