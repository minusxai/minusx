/**
 * FileHealthBadge UI test — the health badge computes the deterministic rubric client-side
 * from Redux content, and opens a panel with findings + a visual-review action.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStore } from '@/store/store';
import { setFile } from '@/store/filesSlice';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { FileHealthBadge } from '@/components/FileHealthPanel';
import type { DbFile } from '@/lib/types';

function seedQuestion(store: ReturnType<typeof makeStore>, id: number, content: unknown) {
  store.dispatch(setFile({ file: { id, name: 'q', path: '/org/q', type: 'question', content } as unknown as DbFile }));
}

describe('FileHealthBadge', () => {
  it('shows a health badge for a question with its overall score', async () => {
    const store = makeStore();
    seedQuestion(store, 1, { description: 'ok', query: 'SELECT 1', vizSettings: { type: 'table' }, parameters: [], connection_name: 'w' });
    renderWithProviders(<FileHealthBadge fileId={1} fileType="question" />, { store });

    const badge = await screen.findByLabelText(/File health:/);
    expect(badge.getAttribute('aria-label')).toContain('of 5');
    expect(badge.getAttribute('aria-label')).toContain('good'); // clean question
  });

  it('opens a panel with the visual-review action', async () => {
    const store = makeStore();
    // Unhealthy: :start referenced but undeclared → a correctness finding.
    seedQuestion(store, 2, { description: '', query: 'SELECT * FROM t WHERE d > :start', vizSettings: { type: 'table' }, parameters: [], connection_name: 'w' });
    renderWithProviders(<FileHealthBadge fileId={2} fileType="question" />, { store });

    await userEvent.click(await screen.findByLabelText(/File health:/));
    await waitFor(async () => {
      expect(await screen.findByLabelText('Run visual review with the LLM judge')).toBeTruthy();
    });
  });

  it('renders nothing for a non-scored file type', () => {
    const store = makeStore();
    renderWithProviders(<FileHealthBadge fileId={3} fileType="folder" />, { store });
    expect(screen.queryByLabelText(/File health:/)).toBeNull();
  });
});
