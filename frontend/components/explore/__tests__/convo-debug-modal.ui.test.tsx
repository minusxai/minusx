// ConvoDebugModal — the /debug full-screen visualization (view component).
// Renders from a prebuilt ConvoDebugModel; footer always shows BOTH expected
// and actual totals; the two toggles (logs source, cost mode) fire callbacks;
// clicking a chart segment opens the read-only component inspector.
// All queries by aria-label per repo convention. The Vega chart is mocked
// (jsdom has no canvas/layout) — chart behavior is covered by the vega-spec
// unit tests + browser verification.

vi.mock('../ConvoDebugChart', () => ({
  default: ({ onInspect }: { onInspect: (b: number, c: number) => void }) => (
    <button aria-label="mock chart segment" onClick={() => onInspect(0, 0)} />
  ),
}));

import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ConvoDebugModal from '../ConvoDebugModal';
import { buildConvoDebugModel } from '@/lib/convo-debug';
import { makeInput, user, assistant, toolResult, rootInvocation, logEntry, usage } from '@/lib/convo-debug/__tests__/fixtures';

function readyModel() {
  const a1 = assistant([{ type: 'text', text: 'b'.repeat(200) }], {
    usage: usage(
      { input: 10, output: 50, cacheRead: 0, cacheWrite: 90, totalTokens: 150 },
      { input: 30e-6, output: 750e-6, cacheRead: 0, cacheWrite: 337.5e-6, total: 1117.5e-6 },
    ),
  });
  const input = makeInput({
    systemPrompt: 'You are an analyst.',
    messages: [user('a'.repeat(400)), a1, toolResult('t9', 'ExecuteQuery', 'c'.repeat(100))],
    log: [rootInvocation('r1'), logEntry(a1, 'r1')],
  });
  return buildConvoDebugModel(input);
}

const noop = () => {};

function renderReady(over: Partial<Parameters<typeof ConvoDebugModal>[0]> = {}) {
  return renderWithProviders(
    <ConvoDebugModal
      state={{ status: 'ready', model: readyModel() }}
      logSource="projected"
      costMode="expected"
      onLogSourceChange={noop}
      onCostModeChange={noop}
      onClose={noop}
      {...over}
    />,
  );
}

describe('ConvoDebugModal', () => {
  it('shows BOTH expected and actual cost totals plus expected next cost in the footer', () => {
    renderReady();
    expect(screen.getByLabelText('expected total cost').textContent).toMatch(/\$/);
    expect(screen.getByLabelText('actual total cost').textContent).toMatch(/\$/);
    expect(screen.getByLabelText('expected next cost').textContent).toMatch(/\$/);
    expect(screen.getByLabelText('total cached input tokens')).toBeTruthy();
    expect(screen.getByLabelText('total uncached input tokens')).toBeTruthy();
    expect(screen.getByLabelText('total output tokens')).toBeTruthy();
    expect(screen.getByLabelText('text tokens')).toBeTruthy();
    expect(screen.getByLabelText('image tokens')).toBeTruthy();
  });

  it('fires the logs-source toggle callback', () => {
    const onLogSourceChange = vi.fn();
    renderReady({ onLogSourceChange });
    fireEvent.click(screen.getByLabelText('logs source toggle'));
    expect(onLogSourceChange).toHaveBeenCalledWith('raw');
  });

  it('fires the cost-mode toggle callback', () => {
    const onCostModeChange = vi.fn();
    renderReady({ onCostModeChange });
    fireEvent.click(screen.getByLabelText('cost mode toggle'));
    expect(onCostModeChange).toHaveBeenCalledWith('actual');
  });

  it('opens the read-only component inspector when a segment is clicked', () => {
    renderReady();
    fireEvent.click(screen.getByLabelText('mock chart segment'));
    expect(screen.getByLabelText('debug component inspector')).toBeTruthy();
  });

  it('renders loading and error states', () => {
    renderWithProviders(
      <ConvoDebugModal
        state={{ status: 'loading' }}
        logSource="projected" costMode="expected"
        onLogSourceChange={noop} onCostModeChange={noop} onClose={noop}
      />,
    );
    expect(screen.getByLabelText('debug loading')).toBeTruthy();

    renderWithProviders(
      <ConvoDebugModal
        state={{ status: 'error', error: 'nope' }}
        logSource="projected" costMode="expected"
        onLogSourceChange={noop} onCostModeChange={noop} onClose={noop}
      />,
    );
    expect(screen.getByLabelText('debug error').textContent).toContain('nope');
  });
});
