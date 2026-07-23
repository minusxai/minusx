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
          { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', reasoning: true, input: ['text'], contextWindow: 200000 },
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
        grades: { core: { providerName: 'main-anthropic', model: 'claude-sonnet-4-6' } },
      }),
    });

    expect(await screen.findByLabelText('LLM provider main-anthropic')).toBeInTheDocument();
    expect(screen.getByLabelText('LLM provider main-anthropic key saved')).toBeInTheDocument();
    // The key input never carries the ref value into the DOM.
    expect((screen.getByLabelText('LLM provider main-anthropic API key') as HTMLInputElement).value).toBe('');
  });

  it('never renders an allowed-models picker (retired: grades replaced allowlists)', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'anthropic', provider: 'anthropic', apiKey: 'k' }] }),
    });
    expect(await screen.findByLabelText('LLM provider anthropic')).toBeInTheDocument();
    expect(screen.queryByLabelText(/allowed models/)).not.toBeInTheDocument();
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

  // Adding a BYOK provider must leave the workspace RUNNABLE. Without this the
  // saved config carries providers and no grades, and every chat dies with
  // "No model is mapped to grade 'core'".
  it('auto-maps every grade to a newly added BYOK provider (as Auto — no model pinned)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, { store: storeWithLlm(undefined) });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add LLM provider'));
    // New entries default to MinusX — switch to a BYOK provider.
    await user.click(screen.getByLabelText('LLM provider minusx type'));
    await user.click(await screen.findByLabelText('Anthropic'));

    // Every grade slot is now mapped (the editor shows providers, not "Set model").
    await waitFor(() => expect(screen.getByLabelText('Core provider')).toBeInTheDocument());
    expect(screen.getByLabelText('Lite provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Advanced provider')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      for (const grade of ['lite', 'core', 'advanced']) {
        expect(body.llm.grades[grade].providerName).toBe('anthropic');
        expect(body.llm.grades[grade].model).toBeUndefined(); // Auto: the compat default per grade
      }
    });
  });

  it('leaves grades unmapped for the managed MinusX provider (the gateway routes them)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, { store: storeWithLlm(undefined) });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add LLM provider'));
    expect(await screen.findByLabelText('Grades managed by MinusX')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.grades).toBeUndefined();
    });
  });

  it('never overwrites a grade that is already mapped when another provider is added', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'anthropic', provider: 'anthropic', apiKey: 'k' }],
        grades: { core: { providerName: 'anthropic', model: 'claude-sonnet-4-6' } },
      }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Add LLM provider'));
    await user.click(screen.getByLabelText('LLM provider minusx type'));
    await user.click(await screen.findByLabelText('OpenAI'));

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.grades.core).toMatchObject({ providerName: 'anthropic', model: 'claude-sonnet-4-6' });
      expect(body.llm.grades.lite.providerName).toBe('openai');   // only the empty slots fill
      expect(body.llm.grades.advanced.providerName).toBe('openai');
    });
  });

  // The stored key is a ref keyed by the OLD provider identity. Carrying it
  // across a type switch sends one vendor's key to another, while the field
  // still badges "saved".
  it('clears the saved API key (and type-specific fields) when the provider type changes', async () => {
    mockFetch();
    const ref = configSecretRefPath('org', 'llm.providers', 'anthropic', 'apiKey');
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'anthropic', provider: 'anthropic', apiKey: ref }] }),
    });
    const user = userEvent.setup();

    expect(await screen.findByLabelText('LLM provider anthropic key saved')).toBeInTheDocument();
    await user.click(screen.getByLabelText('LLM provider anthropic type'));
    await user.click(await screen.findByLabelText('OpenAI'));

    await waitFor(() => expect(screen.getByLabelText('LLM provider openai')).toBeInTheDocument());
    expect(screen.queryByLabelText('LLM provider openai key saved')).not.toBeInTheDocument();
    expect((screen.getByLabelText('LLM provider openai API key') as HTMLInputElement).value).toBe('');
  });

  it('shows the managed banner when MinusX is configured with no explicit grade mappings', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'minusx', provider: 'minusx', apiKey: 'k' }] }),
    });
    expect(await screen.findByLabelText('Grades managed by MinusX')).toBeInTheDocument();
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
    expect(body.model).toBe(ANTHROPIC_DEFAULTS['core']); // probe rides the core grade default
  });

  it('names the model it probed in a successful test result', async () => {
    mockFetch({ '/api/llm/test': { success: true, data: { ok: true, latencyMs: 420, model: 'claude-sonnet-5' } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'main-anthropic', provider: 'anthropic', apiKey: 'sk-new' }] }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Test LLM provider main-anthropic'));
    await waitFor(() => {
      expect(screen.getByLabelText('LLM provider main-anthropic test result')).toHaveTextContent('claude-sonnet-5');
    });
  });

  // Probing the alphabetically-first registry model tests a model the key may
  // not cover (mistral → codestral-latest). With no model to probe there is
  // nothing meaningful to test, so the button says so instead of failing.
  it('disables Test until a model is pickable for providers with no compatibility default', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'mistral', provider: 'mistral', apiKey: 'k' }] }),
    });
    expect(await screen.findByLabelText('Test LLM provider mistral')).toBeDisabled();
  });

  it('enables Test for a curation-less provider once a grade pins a model', async () => {
    const fetchSpy = mockFetch({ '/api/llm/test': { success: true, data: { ok: true, latencyMs: 12 } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'local', provider: 'custom', baseUrl: 'http://localhost:11434/v1' }],
        grades: { core: { providerName: 'local', model: 'qwen3:32b' } },
      }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Test LLM provider local'));
    await waitFor(() => {
      const testCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/llm/test'));
      expect(JSON.parse((testCall![1] as RequestInit).body as string).model).toBe('qwen3:32b');
    });
  });

  it('disables Test for a custom endpoint with no model pinned anywhere', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'local', provider: 'custom', baseUrl: 'http://localhost:11434/v1' }] }),
    });
    expect(await screen.findByLabelText('Test LLM provider local')).toBeDisabled();
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

  it('renders all three grade slots and saves a grade mapping (no chain array)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k1' }] }),
    });
    const user = userEvent.setup();

    expect(await screen.findByLabelText('Model grade Lite')).toBeInTheDocument();
    expect(screen.getByLabelText('Model grade Core')).toBeInTheDocument();
    expect(screen.getByLabelText('Model grade Advanced')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Add Core model'));
    expect(screen.getByLabelText('Core provider')).toBeInTheDocument();
    // The reasoning-options gear is hidden for now (low is stored implicitly).
    expect(screen.queryByLabelText('Core options')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.grades.core.providerName).toBe('a');
      expect(body.llm.grades.core.chain).toBeUndefined();
      expect(body.llm.grades.core.options.reasoning).toBe('low'); // stored explicitly
      expect(body.llm.grades.lite).toBeUndefined();               // untouched slots stay unmapped
    });
  });

  it('renaming a provider cascades into grade mappings (no dangling references)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'OpenAI', provider: 'openai', apiKey: 'k' }],
        grades: { core: { providerName: 'OpenAI', model: 'gpt-4.1' } },
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
      expect(body.llm.grades.core.providerName).toBe('Default');
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

  it('removing a provider drops the grade mappings that referenced it', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [
          { name: 'a', provider: 'anthropic', apiKey: 'k1' },
          { name: 'o', provider: 'openai', apiKey: 'k2' },
        ],
        grades: {
          core: { providerName: 'a', model: 'claude-sonnet-4-6' },
          lite: { providerName: 'o', model: 'gpt-4.1' },
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
      expect(body.llm.grades.core).toBeUndefined();
      expect(body.llm.grades.lite.providerName).toBe('o');
    });
  });

  it("badges each grade's compatibility default in the model picker and sorts it first", async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
        grades: {
          lite: { providerName: 'a' },
          core: { providerName: 'a' },
        },
      }),
    });
    const user = userEvent.setup();

    // Core: only the core default (Sonnet 5) is badged.
    await openModelPicker(user, 'Core model');
    expect(await screen.findByLabelText('Claude Sonnet 5 default')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claude Sonnet 4.6 default')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Claude Haiku 4.5 default')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Claude 3 Opus default')).not.toBeInTheDocument();
    await closePicker(user, 'Core model', 'Claude Sonnet 4.6');

    // Lite: only Haiku is badged, and it sorts above the others
    // (registry order puts it last).
    await openModelPicker(user, 'Lite model');
    expect(await screen.findByLabelText('Claude Haiku 4.5 default')).toBeInTheDocument();
    expect(screen.queryByLabelText('Claude Sonnet 5 default')).not.toBeInTheDocument();
    const haiku = screen.getByLabelText('Claude Haiku 4.5');
    const sonnet = screen.getByLabelText('Claude Sonnet 4.6');
    expect(haiku.compareDocumentPosition(sonnet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an Auto button beside the model picker clears the pick back to the compatibility grade default', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
        grades: { core: { providerName: 'a', model: 'claude-sonnet-4-6' } },
      }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Core model auto'));
    // The picker reflects the auto state and names the model auto resolves to.
    await waitFor(() => {
      expect(screen.getByLabelText('Core model')).toHaveTextContent(`Auto (${ANTHROPIC_DEFAULTS['core']})`);
    });

    await user.click(screen.getByLabelText('Save LLM configuration'));
    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.grades.core.providerName).toBe('a');
      expect(body.llm.grades.core.model).toBeUndefined();
    });
  });

  it('hides the Auto button for providers without compatibility recommendations', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'mistral', provider: 'mistral', apiKey: 'k' }],
        grades: { core: { providerName: 'mistral' } },
      }),
    });

    await waitFor(() => expect(screen.getByLabelText('Core model').tagName).toBe('BUTTON'));
    expect(screen.queryByLabelText('Core model auto')).not.toBeInTheDocument();
  });

  it('shows the five agent policy rows prefilled from the built-in defaults', async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }] }),
    });

    expect(await screen.findByLabelText('Agent analyst grades')).toBeInTheDocument();
    for (const agent of ['analyst', 'web-analyst', 'slack', 'report', 'micro']) {
      expect(screen.getByLabelText(`Agent ${agent} allowed grades`)).toBeInTheDocument();
      expect(screen.getByLabelText(`Agent ${agent} default grade`)).toBeInTheDocument();
    }
    // Built-in defaults surface without any config: analyst allows core +
    // advanced (default core), micro is lite-only.
    expect(screen.getByLabelText('Agent analyst allowed grades')).toHaveTextContent('Core, Advanced');
    expect(screen.getByLabelText('Agent analyst default grade')).toHaveTextContent('Core');
    expect(screen.getByLabelText('Agent micro allowed grades')).toHaveTextContent('Lite');
    expect(screen.getByLabelText('Agent micro default grade')).toHaveTextContent('Lite');
  });

  it("badges the built-in default grade as recommended in each agent's pickers", async () => {
    mockFetch();
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }] }),
    });
    const user = userEvent.setup();

    // micro's built-in default is lite.
    await user.click(await screen.findByLabelText('Agent micro default grade'));
    expect(await screen.findByLabelText('Lite recommended')).toBeInTheDocument();
    expect(screen.queryByLabelText('Core recommended')).not.toBeInTheDocument();
    await closePicker(user, 'Agent micro default grade', 'Lite recommended');

    // analyst's built-in default is core — badged even when another grade is selected.
    await user.click(screen.getByLabelText('Agent analyst default grade'));
    expect(await screen.findByLabelText('Core recommended')).toBeInTheDocument();
    expect(screen.queryByLabelText('Lite recommended')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Advanced'));
    await user.click(screen.getByLabelText('Agent analyst default grade'));
    expect(await screen.findByLabelText('Core recommended')).toBeInTheDocument();
  });

  it('saves a sparse agent policy override (only the touched agent is stored)', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({ providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }] }),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Agent slack default grade'));
    await user.click(await screen.findByLabelText('Advanced'));
    await user.click(screen.getByLabelText('Save LLM configuration'));

    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.agents.slack.defaultGrade).toBe('advanced');
      // Only the touched agent is stored — the rest stay on built-ins.
      expect(body.llm.agents.analyst).toBeUndefined();
    });
  });

  it('drops a stored agent override when reset back to the built-in policy', async () => {
    const fetchSpy = mockFetch({ '/api/configs': { success: true, data: { config: {} } } });
    renderWithProviders(<LlmModelsSection />, {
      store: storeWithLlm({
        providers: [{ name: 'a', provider: 'anthropic', apiKey: 'k' }],
        agents: { slack: { allowedGrades: ['core', 'advanced'], defaultGrade: 'advanced' } },
      }),
    });
    const user = userEvent.setup();

    expect(await screen.findByLabelText('Agent slack default grade')).toHaveTextContent('Advanced');
    await user.click(screen.getByLabelText('Agent slack default grade'));
    await user.click(await screen.findByLabelText('Core'));
    await user.click(screen.getByLabelText('Save LLM configuration'));

    await waitFor(() => {
      const configCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/api/configs'));
      const body = JSON.parse((configCall![1] as RequestInit).body as string);
      expect(body.llm.agents?.slack).toBeUndefined();
    });
  });
});
