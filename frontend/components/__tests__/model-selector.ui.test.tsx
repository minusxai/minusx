import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { ModelSelector } from '@/components/explore/ModelSelector';

describe('ModelSelector', () => {
  it('shows the configured default and groups allowed choices by provider', async () => {
    const onChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        defaultModel: {
          providerName: 'anthropic', providerLabel: 'Anthropic',
          model: 'claude-sonnet-4-6', modelLabel: 'Claude Sonnet 4.6',
        },
        models: [
          { providerName: 'anthropic', providerLabel: 'Anthropic', model: 'claude-opus-4-8', modelLabel: 'Claude Opus 4.8' },
          { providerName: 'openai', providerLabel: 'OpenAI', model: 'gpt-5.4', modelLabel: 'GPT-5.4' },
        ],
      },
    }), { status: 200 })));

    renderWithProviders(<ModelSelector value={null} onChange={onChange} />);

    const trigger = await screen.findByLabelText('Chat model');
    await waitFor(() => expect(trigger.textContent).toContain('Claude Sonnet 4.6'));
    fireEvent.click(trigger);

    expect((await screen.findAllByText('Anthropic')).length).toBeGreaterThan(0);
    expect(screen.getByText('OpenAI')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Claude Opus 4.8'));

    expect(onChange).toHaveBeenCalledWith({ providerName: 'anthropic', model: 'claude-opus-4-8' });
  });
});
