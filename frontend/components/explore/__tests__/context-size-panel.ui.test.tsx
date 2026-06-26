// ContextSizePanel — verifies the per-section cached column: each section row shows how many of its
// tokens the provider served from the prompt cache last turn (prefix overlap) vs the section total.
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

describe('ContextSizePanel — per-section cached column', () => {
  it('shows each section as "cached / total", splitting the cached prefix across sections', () => {
    // 15,000 cached over [system_prompt 12k, app_state 8k] → all 12k of system_prompt, then 3k of app_state.
    render({ status: 'ready', estimate, cachedTokens: 15_000 });

    const sys = screen.getByLabelText('section system_prompt tokens');
    expect(sys.textContent).toContain('12,000 / 12,000');

    const app = screen.getByLabelText('section app_state tokens');
    expect(app.textContent).toContain('3,000 / 8,000');
  });

  it('shows 0 cached for every section when nothing was cached', () => {
    render({ status: 'ready', estimate, cachedTokens: 0 });
    expect(screen.getByLabelText('section system_prompt tokens').textContent).toContain('0 / 12,000');
    expect(screen.getByLabelText('section app_state tokens').textContent).toContain('0 / 8,000');
  });

  it('treats absent cachedTokens as all-uncached', () => {
    render({ status: 'ready', estimate });
    expect(screen.getByLabelText('section system_prompt tokens').textContent).toContain('0 / 12,000');
  });

  it('no longer renders the old single "Cached last turn" summary line', () => {
    render({ status: 'ready', estimate, cachedTokens: 15_000 });
    expect(screen.queryByLabelText('cached tokens last turn')).toBeNull();
  });
});
