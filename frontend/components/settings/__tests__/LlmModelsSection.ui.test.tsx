import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { LlmModelsSection } from '@/components/settings/llm/LlmModelsSection';
import { configSecretRefPath } from '@/lib/secrets/config-secret-specs';
import type { OrgConfig } from '@/lib/branding/whitelabel';

const REGISTRY = {
  success: true,
  data: {
    providers: [
      { slug: 'anthropic', models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', reasoning: true, input: ['text'], contextWindow: 200000 }] },
      { slug: 'openai', models: [{ id: 'gpt-4.1', name: 'GPT-4.1', reasoning: false, input: ['text'], contextWindow: 128000 }] },
    ],
  },
};

function mockFetch(routes: Record<string, unknown> = {}) {
  const spy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    for (const [path, body] of Object.entries({ '/api/llm/registry': REGISTRY, ...routes })) {
      if (url.includes(path)) {
        return { ok: true, status: 200, json: async () => body } as Response;
      }
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) } as Response;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function storeWithLlm(llm: OrgConfig['llm']) {
  const store = makeStore();
  const config = store.getState().configs.config;
  return makeStore({ configs: { config: { ...config, llm }, loaded: true } } as never);
}

describe('LlmModelsSection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('renders configured providers with a saved-key badge (refs, never raw keys)', async () => {
    mockFetch();
    const ref = configSecretRefPath('org', 'llm.providers', 'main-anthropic', 'apiKey');
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'main-anthropic', provider: 'anthropic', apiKey: ref }],
        assignments: { analyst: { chain: [{ providerName: 'main-anthropic', model: 'claude-sonnet-4-6' }] } },
      }),
    });

    expect(await screen.findByLabelText('LLM provider main-anthropic')).toBeInTheDocument();
    expect(screen.getByLabelText('LLM provider main-anthropic key saved')).toBeInTheDocument();
    // The key input never carries the ref value into the DOM.
    expect((screen.getByLabelText('LLM provider main-anthropic API key') as HTMLInputElement).value).toBe('');
  });

  it('adds a provider (MinusX pinned as the default pick) and saves via /api/configs', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, { store: storeWithLlm(undefined) });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add LLM provider'));
    // New entry defaults to the managed MinusX provider, auto-named.
    const typeInput = screen.getByLabelText('LLM provider minusx type') as HTMLInputElement;
    expect(typeInput.value).toBe('MinusX (managed)');

    await user.type(screen.getByLabelText('LLM provider minusx API key'), 'mx-key-123');
    await user.click(screen.getByLabelText('Save LLM configuration'));

    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      expect(configCall).toBeTruthy();
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.providers[0]).toMatchObject({ name: 'minusx', provider: 'minusx', apiKey: 'mx-key-123' });
    });
  });

  it('shows the managed banner when MinusX is configured with no explicit assignments', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'minusx', provider: 'minusx', apiKey: 'k' }] }),
    });
    expect(await screen.findByLabelText('Assignments managed by MinusX')).toBeInTheDocument();
  });

  it('tests a provider through /api/llm/test and shows the result', async () => {
    const fetchSpy = mockFetch({ '/api/llm/test': { success: true, data: { ok: true, latencyMs: 420 } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'main-anthropic', provider: 'anthropic', apiKey: 'sk-new' }] }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Test LLM provider main-anthropic'));

    await waitFor(() => {
      expect(screen.getByLabelText('LLM provider main-anthropic test result')).toHaveTextContent('Connected (420ms)');
    });
    const testCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/llm/test'));
    const body = JSON.parse((testCall![1] as RequestInit).body as string);
    expect(body.provider.apiKey).toBe('sk-new');
    expect(body.model).toBe('claude-sonnet-4-6'); // registry default for the provider
  });

  it('shows a failing test result', async () => {
    mockFetch({ '/api/llm/test': { success: true, data: { ok: false, error: 'invalid x-api-key' } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'bad', provider: 'anthropic', apiKey: 'nope' }] }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Test LLM provider bad'));
    await waitFor(() => {
      expect(screen.getByLabelText('LLM provider bad test result')).toHaveTextContent('invalid x-api-key');
    });
  });

  it('builds an assignment chain with fallbacks', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [
          { name: 'a', provider: 'anthropic', apiKey: 'k1' },
          { name: 'o', provider: 'openai', apiKey: 'k2' },
        ],
      }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add Analyst model'));
    expect(screen.getByLabelText('Analyst primary provider')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Add Analyst fallback'));
    expect(screen.getByLabelText('Analyst fallback 1 provider')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.assignments.analyst.chain).toHaveLength(2);
      expect(body.llm.assignments.analyst.chain[0].providerName).toBe('a');
    });
  });

  it('renaming a provider cascades into assignment chains (no dangling references)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'OpenAI', provider: 'openai', apiKey: 'k' }],
        assignments: { analyst: { chain: [{ providerName: 'OpenAI', model: 'gpt-4.1' }] } },
      }),
    });
    const user = userEvent.setup();

    const nameInput = await screen.findByLabelText('LLM provider OpenAI name');
    // Single change event (paste-like) — types the new name over the old one.
    fireEvent.change(nameInput, { target: { value: 'Default' } });
    await user.click(screen.getByLabelText('Save LLM configuration'));

    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.providers[0].name).toBe('Default');
      expect(body.llm.assignments.analyst.chain[0].providerName).toBe('Default');
    });
  });

  it('name is optional: a new provider gets an auto name, and a blanked name falls back on save', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, { store: storeWithLlm(undefined) });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add LLM provider'));
    // Auto-named after the default provider type (minusx).
    expect((screen.getByLabelText('LLM provider minusx name') as HTMLInputElement).value).toBe('minusx');

    // Blank it out — save falls back to the auto name instead of erroring.
    await user.clear(screen.getByLabelText('LLM provider minusx name'));
    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.providers[0].name).toBe('minusx');
    });
  });

  it('removing a provider drops chain steps that referenced it', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [
          { name: 'a', provider: 'anthropic', apiKey: 'k1' },
          { name: 'o', provider: 'openai', apiKey: 'k2' },
        ],
        assignments: {
          analyst: { chain: [{ providerName: 'a', model: 'claude-sonnet-4-6' }, { providerName: 'o', model: 'gpt-4.1' }] },
        },
      }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Remove LLM provider a'));
    await user.click(screen.getByLabelText('Save LLM configuration'));

    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.providers).toHaveLength(1);
      expect(body.llm.assignments.analyst.chain).toHaveLength(1);
      expect(body.llm.assignments.analyst.chain[0].providerName).toBe('o');
    });
  });
});
