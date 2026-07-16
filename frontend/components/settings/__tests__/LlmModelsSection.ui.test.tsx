import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { makeStore } from '@/store/store';
import { LlmModelsSection } from '@/components/settings/llm/LlmModelsSection';
import { configSecretRefPath } from '@/lib/secrets/config-secret-specs';
import compatibility from '@/compatibility.json';
import type { OrgConfig } from '@/lib/branding/whitelabel';

// Auto assertions derive from compatibility.json so curation edits don't
// break them (the contract test guards the data itself).
const ANTHROPIC_DEFAULTS = (compatibility.llm.providers as { id: string; defaults?: Record<string, string> }[])
  .find(p => p.id === 'anthropic')!.defaults!;

const REGISTRY = {
  success: true,
  data: {
    providers: [
      {
        slug: 'anthropic',
        models: [
          { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', reasoning: true, input: ['text'], contextWindow: 200000 },
          { id: 'claude-3-opus', name: 'Claude 3 Opus', reasoning: false, input: ['text'], contextWindow: 200000 },
          { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', reasoning: true, input: ['text'], contextWindow: 200000 },
        ],
      },
      { slug: 'openai', models: [{ id: 'gpt-4.1', name: 'GPT-4.1', reasoning: false, input: ['text'], contextWindow: 128000 }] },
      // A registry provider with NO compatibility.json curation (no recommended/defaults).
      { slug: 'mistral', models: [{ id: 'mistral-large', name: 'Mistral Large', reasoning: false, input: ['text'], contextWindow: 128000 }] },
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

function storeWithLlm(llm: OrgConfig['llm'], mode: string = 'org') {
  const store = makeStore();
  const config = store.getState().configs.config;
  return makeStore({
    configs: { config: { ...config, llm }, loaded: true },
    auth: { user: { id: 1, email: 'a@b.c', name: 'A', role: 'admin', mode }, loading: false },
  } as never);
}

/**
 * Open a model picker by label. Until the registry fetch resolves, the model
 * control renders as a free-text input — wait for the picker (a button) to
 * replace it before clicking.
 */
async function openModelPicker(user: ReturnType<typeof userEvent.setup>, label: string) {
  await waitFor(() => expect(screen.getByLabelText(label).tagName).toBe('BUTTON'));
  await user.click(screen.getByLabelText(label));
}

/** Close an open picker by re-clicking its trigger (toggles), waiting for the popover to unmount. */
async function closePicker(user: ReturnType<typeof userEvent.setup>, label: string, goneOption: string) {
  await user.click(screen.getByLabelText(label));
  await waitFor(() => expect(screen.queryByLabelText(goneOption)).not.toBeInTheDocument());
}

describe('LlmModelsSection', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  // LLM config is workspace-level (resolution always reads the ORG config,
  // whatever the caller's mode) — so outside org mode the editor is replaced
  // by a read-only notice, preventing edits landing in a per-mode config doc
  // that resolution would silently ignore.
  it('replaces the editor with a workspace-level notice outside org mode', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'openai', provider: 'openai' }] }, 'tutorial'),
    });
    expect(await screen.findByLabelText('Models workspace-level notice')).toBeInTheDocument();
    expect(screen.getByLabelText('Open workspace settings')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add LLM provider')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('LLM provider openai')).not.toBeInTheDocument();
  });

  it('renders the editor normally in org mode', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'openai', provider: 'openai' }] }, 'org'),
    });
    expect(await screen.findByLabelText('LLM provider openai')).toBeInTheDocument();
    expect(screen.queryByLabelText('Models workspace-level notice')).not.toBeInTheDocument();
  });

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
    expect(screen.getByLabelText('LLM provider minusx type')).toHaveTextContent('MinusX (managed)');

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

  it('model options live behind a gear button; reasoning defaults to low and is stored explicitly', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k1' }] }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add Analyst model'));
    // No inline reasoning dropdown — an options gear instead.
    expect(screen.queryByLabelText('Analyst reasoning')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Analyst options'));
    // 'low' is pre-selected (the default) — no ambiguous 'default' option exists.
    expect(await screen.findByLabelText('Reasoning effort low selected')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Reasoning effort default/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Set reasoning effort high'));
    await user.click(screen.getByLabelText('Close model options'));

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.assignments.analyst.chain[0].options.reasoning).toBe('high');
    });
  });

  it('a new chain step stores reasoning low explicitly (what you see is what is saved)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k1' }] }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add Analyst model'));
    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.assignments.analyst.chain[0].options.reasoning).toBe('low');
    });
  });

  it('assigns exactly ONE model per use case — no fallback affordance exists', async () => {
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
    expect(screen.getByLabelText('Analyst provider')).toBeInTheDocument();
    // Once a model is set, there is no way to add another (fallbacks removed).
    expect(screen.queryByLabelText('Add Analyst fallback')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add Analyst model')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.assignments.analyst.chain).toHaveLength(1);
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

  it('hides the name field entirely for a single provider of a type (auto-named by the type)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, { store: storeWithLlm(undefined) });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add LLM provider'));
    // Single provider of its type: no name field at all.
    expect(screen.queryByLabelText('LLM provider minusx name')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.providers[0].name).toBe('minusx'); // auto = provider type
    });
  });

  it('shows name fields only when a provider type is duplicated', async () => {
    mockFetch();
    // One openai provider: no name field.
    const single = renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'openai', provider: 'openai', apiKey: 'k' }] }),
    });
    expect(await screen.findByLabelText('LLM provider openai')).toBeInTheDocument();
    expect(screen.queryByLabelText('LLM provider openai name')).not.toBeInTheDocument();
    single.unmount();

    // Two openai providers: BOTH entries show their name field.
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [
          { name: 'openai', provider: 'openai', apiKey: 'k1' },
          { name: 'openai-2', provider: 'openai', apiKey: 'k2' },
        ],
      }),
    });
    expect(await screen.findByLabelText('LLM provider openai name')).toBeInTheDocument();
    expect(screen.getByLabelText('LLM provider openai-2 name')).toBeInTheDocument();
  });

  it('keeps a custom name visible even without duplicates (clearing it hides the field again)', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'Default', provider: 'openai', apiKey: 'k' }] }),
    });
    const nameInput = await screen.findByLabelText('LLM provider Default name');
    expect((nameInput as HTMLInputElement).value).toBe('Default');

    fireEvent.change(nameInput, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.queryByLabelText(/LLM provider .* name/)).not.toBeInTheDocument();
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

  it('picks allowed models per provider and saves them to allowedModels', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'anthropic', provider: 'anthropic', apiKey: 'k' }] }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('LLM provider anthropic allowed models'));
    await user.click(await screen.findByLabelText('Claude Haiku 4.5'));
    await user.click(screen.getByLabelText('Save LLM configuration'));

    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      expect(configCall).toBeTruthy();
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.providers[0].allowedModels).toEqual(['claude-haiku-4-5']);
    });
  });

  it('shows no allowed-models picker for the managed MinusX provider', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'minusx', provider: 'minusx', apiKey: 'k' }] }),
    });
    expect(await screen.findByLabelText('LLM provider minusx')).toBeInTheDocument();
    expect(screen.queryByLabelText('LLM provider minusx allowed models')).not.toBeInTheDocument();
  });

  it('filters the assignment model picker to the provider allowedModels', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k', allowedModels: ['claude-haiku-4-5'] }],
        assignments: { analyst: { chain: [{ providerName: 'a' }] } },
      }),
    });
    const user = userEvent.setup();

    await openModelPicker(user, 'Analyst model');
    expect(await screen.findByLabelText('Claude Haiku 4.5')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claude Sonnet 4.6')).not.toBeInTheDocument();
  });

  it('shows all registry models in the assignment picker when no allowlist is set', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
        assignments: { analyst: { chain: [{ providerName: 'a' }] } },
      }),
    });
    const user = userEvent.setup();

    await openModelPicker(user, 'Analyst model');
    expect(await screen.findByLabelText('Claude Haiku 4.5')).toBeInTheDocument();
    expect(screen.getByLabelText('Claude Sonnet 4.6')).toBeInTheDocument();
  });

  it('keeps a currently-assigned model visible even when outside the allowlist', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k', allowedModels: ['claude-haiku-4-5'] }],
        assignments: { analyst: { chain: [{ providerName: 'a', model: 'claude-sonnet-4-6' }] } },
      }),
    });
    const user = userEvent.setup();

    // The existing pick still shows on the trigger and in the list. (The
    // trigger swaps from free-text input to picker once the registry loads —
    // re-query until then.)
    await waitFor(() => {
      expect(screen.getByLabelText('Analyst model')).toHaveTextContent('Claude Sonnet 4.6');
    });
    await user.click(screen.getByLabelText('Analyst model'));
    expect(await screen.findByLabelText('Claude Sonnet 4.6')).toBeInTheDocument();
    expect(screen.getByLabelText('Claude Haiku 4.5')).toBeInTheDocument();
  });

  it('badges recommended models per use case (compatibility.json) and sorts them first', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
        assignments: {
          analyst: { chain: [{ providerName: 'a' }] },
          micro: { chain: [{ providerName: 'a' }] },
        },
      }),
    });
    const user = userEvent.setup();

    // Analyst: Sonnet is recommended for analyst; Haiku (micro-only) and the
    // uncurated Opus are not.
    await openModelPicker(user, 'Analyst model');
    expect(await screen.findByLabelText('Claude Sonnet 4.6 recommended')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claude Haiku 4.5 recommended')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Claude 3 Opus recommended')).not.toBeInTheDocument();
    await closePicker(user, 'Analyst model', 'Claude Sonnet 4.6');

    // Micro: only Haiku is recommended, and it sorts above the others
    // (registry order puts it last).
    await openModelPicker(user, 'Micro tasks model');
    expect(await screen.findByLabelText('Claude Haiku 4.5 recommended')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claude Sonnet 4.6 recommended')).not.toBeInTheDocument();
    const haiku = screen.getByLabelText('Claude Haiku 4.5');
    const sonnet = screen.getByLabelText('Claude Sonnet 4.6');
    expect(haiku.compareDocumentPosition(sonnet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await closePicker(user, 'Micro tasks model', 'Claude Sonnet 4.6');

    // The provider-level allowed-models picker has no use case: it badges the
    // union of all use cases' recommendations.
    await user.click(screen.getByLabelText('LLM provider a allowed models'));
    expect(await screen.findByLabelText('Claude Sonnet 4.6 recommended')).toBeInTheDocument();
    expect(screen.getByLabelText('Claude Haiku 4.5 recommended')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claude 3 Opus recommended')).not.toBeInTheDocument();
  });

  it('an Auto button beside the model picker clears the pick back to the compatibility default', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
        assignments: { analyst: { chain: [{ providerName: 'a', model: 'claude-sonnet-4-6' }] } },
      }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Analyst model auto'));
    // The picker reflects the auto state and names the model auto resolves to.
    await waitFor(() => {
      expect(screen.getByLabelText('Analyst model')).toHaveTextContent(`Auto (${ANTHROPIC_DEFAULTS['analyst']})`);
    });

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.assignments.analyst.chain[0].providerName).toBe('a');
      expect(body.llm.assignments.analyst.chain[0].model).toBeUndefined();
    });
  });

  it('flags an Auto assignment whose compatibility default is excluded by allowed models', async () => {
    // The scenario needs distinct defaults: allow only the micro default, so
    // the analyst auto pick is excluded and the micro one is not.
    expect(ANTHROPIC_DEFAULTS['analyst']).not.toBe(ANTHROPIC_DEFAULTS['micro']);
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k', allowedModels: [ANTHROPIC_DEFAULTS['micro']] }],
        assignments: {
          analyst: { chain: [{ providerName: 'a' }] },
          micro: { chain: [{ providerName: 'a' }] },
        },
      }),
    });

    // Analyst auto default is excluded by the allowlist.
    expect(await screen.findByLabelText('Analyst auto model conflict')).toHaveTextContent(ANTHROPIC_DEFAULTS['analyst']);
    // Micro auto default is allowed — no conflict.
    expect(screen.queryByLabelText('Micro tasks auto model conflict')).not.toBeInTheDocument();
  });

  it("an Auto button beside allowed models stores 'auto' and toggles back to all", async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'anthropic', provider: 'anthropic', apiKey: 'k' }] }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('LLM provider anthropic allowed models auto'));
    expect(screen.getByLabelText('LLM provider anthropic allowed models')).toHaveTextContent('Auto (recommended)');

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.providers[0].allowedModels).toBe('auto');
    });

    // Toggling Auto off returns to unrestricted (All models).
    await user.click(screen.getByLabelText('LLM provider anthropic allowed models auto'));
    expect(screen.getByLabelText('LLM provider anthropic allowed models')).toHaveTextContent('All models');
  });

  it("an 'auto' allowlist bounds the assignment picker to the recommended union", async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k', allowedModels: 'auto' }],
        assignments: { analyst: { chain: [{ providerName: 'a' }] } },
      }),
    });
    const user = userEvent.setup();

    await openModelPicker(user, 'Analyst model');
    expect(await screen.findByLabelText('Claude Sonnet 4.6')).toBeInTheDocument();
    expect(screen.getByLabelText('Claude Haiku 4.5')).toBeInTheDocument();
    // Uncurated model: outside the recommended union → filtered out.
    expect(screen.queryByLabelText('Claude 3 Opus')).not.toBeInTheDocument();
  });

  it('hides both Auto buttons for providers without compatibility recommendations', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'mistral', provider: 'mistral', apiKey: 'k' }],
        assignments: { analyst: { chain: [{ providerName: 'mistral' }] } },
      }),
    });

    // The pickers themselves render (the registry serves models)…
    expect(await screen.findByLabelText('LLM provider mistral allowed models')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Analyst model').tagName).toBe('BUTTON'));
    // …but with nothing recommended, there is no Auto to offer.
    expect(screen.queryByLabelText('LLM provider mistral allowed models auto')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Analyst model auto')).not.toBeInTheDocument();
  });

  it('switching a provider type clears its allowedModels (they belong to the old registry)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'anthropic', provider: 'anthropic', apiKey: 'k', allowedModels: ['claude-haiku-4-5'] }],
      }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('LLM provider anthropic type'));
    await user.click(await screen.findByLabelText('OpenAI'));
    await user.click(screen.getByLabelText('Save LLM configuration'));

    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.providers[0].provider).toBe('openai');
      expect(body.llm.providers[0].allowedModels).toBeUndefined();
    });
  });
});
