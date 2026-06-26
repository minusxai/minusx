// ContextSizePanel — verifies the per-section cached column: each section row shows how many of its
// tokens the provider served from the prompt cache last turn (prefix overlap) vs the section total.
// All queries by aria-label per repo convention.
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { ContextSizePanel, type ContextSizePanelState } from '../ContextSizePanel';
import type { ContextSizeEstimate } from '@/lib/chat/context-size-estimate';

const estimate: ContextSizeEstimate = {
  totalTokens: 23_000,
  totalChars: 92_000,
  method: 'estimated',
  sections: [
    { key: 'system_prompt', label: 'System prompt', tokens: 12_000, chars: 48_000 },
    { key: 'tool_definitions', label: 'Tool definitions', tokens: 3_000, chars: 12_000 },
    { key: 'app_state', label: 'App state', tokens: 8_000, chars: 32_000 }, // fresh (current turn)
  ],
};

function render(state: ContextSizePanelState) {
  renderWithProviders(
    <ContextSizePanel state={state} onClose={() => {}} colSpan={12} colStart={1} />,
  );
}

describe('ContextSizePanel — per-section cached column', () => {
  it('fills the cacheable wire prefix (system → tools) and shows fresh sections as uncached', () => {
    // 13,000 cached → all of system_prompt (12k) + 1k of tool_definitions; app_state is FRESH → 0.
    render({ status: 'ready', estimate, cachedTokens: 13_000 });

    expect(screen.getByLabelText('section system_prompt tokens').textContent).toContain('12,000 / 12,000');
    expect(screen.getByLabelText('section tool_definitions tokens').textContent).toContain('1,000 / 3,000');
    expect(screen.getByLabelText('section app_state tokens').textContent).toContain('0 / 8,000');
  });

  it('keeps fresh current-turn sections uncached even when the cached prefix is huge', () => {
    render({ status: 'ready', estimate, cachedTokens: 1_000_000 });
    // system + tools fully cached, app_state (fresh) still 0
    expect(screen.getByLabelText('section system_prompt tokens').textContent).toContain('12,000 / 12,000');
    expect(screen.getByLabelText('section tool_definitions tokens').textContent).toContain('3,000 / 3,000');
    expect(screen.getByLabelText('section app_state tokens').textContent).toContain('0 / 8,000');
  });

  it('shows 0 cached for every section when nothing was cached', () => {
    render({ status: 'ready', estimate, cachedTokens: 0 });
    expect(screen.getByLabelText('section system_prompt tokens').textContent).toContain('0 / 12,000');
    expect(screen.getByLabelText('section tool_definitions tokens').textContent).toContain('0 / 3,000');
  });

  it('no longer renders the old single "Cached last turn" summary line', () => {
    render({ status: 'ready', estimate, cachedTokens: 13_000 });
    expect(screen.queryByLabelText('cached tokens last turn')).toBeNull();
  });
});
