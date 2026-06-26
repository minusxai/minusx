// ContextSizePanel — verifies the cached-tokens overlay (#2): tokens the provider served from the
// prompt cache last turn render as a "Cached last turn" legend row + black-bordered prefix squares.
// All queries by aria-label per repo convention.
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { ContextSizePanel, type ContextSizePanelState } from '../ContextSizePanel';
import type { ContextSizeEstimate } from '@/lib/chat/context-size-estimate';

const estimate: ContextSizeEstimate = {
  totalTokens: 20_000,
  totalChars: 80_000,
  method: 'estimated',
  sections: [
    { key: 'system_prompt', label: 'System prompt', tokens: 12_000, chars: 48_000 },
    { key: 'app_state', label: 'App state', tokens: 8_000, chars: 32_000 },
  ],
};

function render(state: ContextSizePanelState) {
  renderWithProviders(
    <ContextSizePanel state={state} onClose={() => {}} colSpan={12} colStart={1} />,
  );
}

describe('ContextSizePanel — cached tokens', () => {
  it('shows the "Cached last turn" legend with the token count when cachedTokens > 0', () => {
    render({ status: 'ready', estimate, cachedTokens: 15_000 });
    const legend = screen.getByLabelText('cached tokens last turn');
    expect(legend.textContent).toContain('Cached last turn');
    expect(legend.textContent).toContain('15,000');
  });

  it('omits the cached legend when there were no cached tokens', () => {
    render({ status: 'ready', estimate, cachedTokens: 0 });
    expect(screen.queryByLabelText('cached tokens last turn')).toBeNull();
  });

  it('omits the cached legend when cachedTokens is absent', () => {
    render({ status: 'ready', estimate });
    expect(screen.queryByLabelText('cached tokens last turn')).toBeNull();
  });
});
