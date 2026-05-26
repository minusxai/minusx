/**
 * Cycle 10: SimpleChatMessage renders the new `role:'error'` message row distinctly,
 * with aria-label that includes the source and the error text visible in the DOM.
 */
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import SimpleChatMessage from '@/components/explore/SimpleChatMessage';

describe('SimpleChatMessage — error row rendering', () => {
  it('renders the error row with aria-label "error message <source>" and the message text', () => {
    const errorMsg = {
      role: 'error',
      source: 'transport',
      content: 'fetch failed (ECONNREFUSED)',
      created_at: '2024-01-01T00:00:00Z',
      details: { http_status: 502 },
    } as any;

    renderWithProviders(
      <SimpleChatMessage message={errorMsg} showThinking={false} toggleShowThinking={() => {}} />,
    );

    const row = screen.getByLabelText('error message transport');
    expect(row).toBeTruthy();
    // The error message text is inside the row.
    expect(row.textContent).toMatch(/fetch failed/i);
    // The HTTP status detail is also surfaced.
    expect(row.textContent).toMatch(/502/);
  });

  it('renders the tool_name detail when source is "frontend-tool"', () => {
    const errorMsg = {
      role: 'error',
      source: 'frontend-tool',
      content: 'String "x" not found in file',
      created_at: '2024-01-01T00:00:00Z',
      details: { tool_name: 'EditFile', tool_call_id: 'tc_edit_001' },
    } as any;

    renderWithProviders(<SimpleChatMessage message={errorMsg} showThinking={false} toggleShowThinking={() => {}} />);

    const row = screen.getByLabelText('error message frontend-tool');
    expect(row.textContent).toMatch(/EditFile/);
    expect(row.textContent).toMatch(/not found/i);
  });
});
