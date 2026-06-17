/**
 * UI tests for the harmonized share lead gate + reusable explore welcome.
 *
 * Covers:
 *  1. Lead gate renders the name/email form and submit button
 *  2. Story-specific questions appear as locked teasers (not clickable)
 *  3. Falls back to generic prompts when no story questions are supplied
 *  4. Submitting forwards trimmed name/email
 *  5. ExampleQuestions renders custom prompts and they are clickable
 */

vi.mock('@/lib/database/db-config', () => ({
  PGLITE_DATA_DIR: undefined,
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import ShareLeadGate from '@/components/share/ShareLeadGate';
import ExampleQuestions from '@/components/explore/message/ExampleQuestions';

describe('ShareLeadGate', () => {
  it('renders the sign-in form', () => {
    renderWithProviders(<ShareLeadGate onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Your email')).toBeInTheDocument();
    expect(screen.getByLabelText('Start chatting')).toBeInTheDocument();
  });

  it('shows story-specific questions as locked teasers', () => {
    renderWithProviders(
      <ShareLeadGate onSubmit={vi.fn()} suggestedPrompts={['Which region drove the drop?']} />,
    );
    expect(screen.getByText('Which region drove the drop?')).toBeInTheDocument();
    // Locked teaser is non-interactive — no generic default prompt leaks through.
    expect(screen.queryByText('What all can you do?')).not.toBeInTheDocument();
  });

  it('falls back to generic prompts when no story questions are supplied', () => {
    renderWithProviders(<ShareLeadGate onSubmit={vi.fn()} />);
    expect(screen.getByText('What all can you do?')).toBeInTheDocument();
  });

  it('submits trimmed name and email', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<ShareLeadGate onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Your name'), '  Ada  ');
    await userEvent.type(screen.getByLabelText('Your email'), 'ada@x.com');
    await userEvent.click(screen.getByLabelText('Start chatting'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Ada', 'ada@x.com'));
  });
});

describe('ExampleQuestions custom prompts', () => {
  const colProps = { colSpan: 12, colStart: 1 };

  it('renders and fires custom prompts on click', async () => {
    const onPromptClick = vi.fn();
    renderWithProviders(
      <ExampleQuestions onPromptClick={onPromptClick} customPrompts={['Show Q3 trend']} {...colProps} />,
    );
    const card = screen.getByText('Show Q3 trend');
    expect(card).toBeInTheDocument();
    await userEvent.click(card);
    expect(onPromptClick).toHaveBeenCalledWith('Show Q3 trend');
  });

  it('renders generic defaults when no custom prompts given', () => {
    renderWithProviders(<ExampleQuestions onPromptClick={vi.fn()} {...colProps} />);
    expect(screen.getByText('What all can you do?')).toBeInTheDocument();
  });
});
