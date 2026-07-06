import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/helpers/render-with-providers'
import ParameterInput from '@/components/params/ParameterInput'
import type { QuestionParameter } from '@/lib/types'

// SourceConfigPopover + source widgets reach for file-state hooks; stub them so
// these tests stay focused on the label/display-name behaviour.
vi.mock('@/lib/hooks/file-state-hooks', () => ({
  useFile: () => undefined,
  useFilesByCriteria: () => ({ files: [] }),
  useQueryResult: () => ({ data: null, loading: false, error: null }),
}))

const baseParam = (over: Partial<QuestionParameter> = {}): QuestionParameter => ({
  name: 'start_date',
  type: 'date',
  label: null,
  source: null,
  ...over,
})

const noop = () => {}

describe('ParameterInput display name', () => {
  it('shows an auto-generated Title Case label from the param name', () => {
    renderWithProviders(
      <ParameterInput parameter={baseParam()} value="" onChange={noop} onTypeChange={noop} />
    )
    expect(screen.getByLabelText('Parameter start_date')).toHaveTextContent('Start Date')
  })

  it('shows the custom label when one is set', () => {
    renderWithProviders(
      <ParameterInput parameter={baseParam({ label: 'Begin' })} value="" onChange={noop} onTypeChange={noop} />
    )
    expect(screen.getByLabelText('Parameter start_date')).toHaveTextContent('Begin')
  })

  it('edits the display name via the config popover', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [p, setP] = React.useState<QuestionParameter>(baseParam({ type: 'text' }))
      return (
        <ParameterInput
          parameter={p}
          value=""
          onChange={noop}
          onTypeChange={noop}
          onParameterChange={setP}
        />
      )
    }
    renderWithProviders(<Harness />)

    await user.click(screen.getByLabelText('Configure source'))
    await user.type(screen.getByLabelText('Display name for start_date'), 'Begin')

    expect(await screen.findByLabelText('Parameter start_date')).toHaveTextContent('Begin')
  })
})
