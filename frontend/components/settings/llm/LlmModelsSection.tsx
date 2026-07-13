'use client';

/**
 * LLM Models settings — in-app provider + model configuration (admin-only).
 *
 * Two-level editor over the org config's `llm` section:
 *   1. Providers — credentialed endpoints (MinusX managed / registry providers /
 *      custom OpenAI-compatible), each testable via POST /api/llm/test.
 *   2. Assignments — per use case (analyst / micro): an ordered model chain
 *      `[primary, ...fallbacks]`, with searchable model pickers fed by
 *      GET /api/llm/registry.
 *
 * MinusX special-casing: the MinusX provider is pinned first in the picker and
 * needs only an API key — with no explicit assignments, the gateway handles
 * model routing for every use case, so the assignments editor collapses to an
 * informational banner.
 *
 * Secrets: saved keys arrive as `@SECRETS/…` refs (never raw). A ref value
 * round-trips unchanged on save; typing a new key replaces it server-side.
 * Reused by the setup wizard (`variant="wizard"`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Box, Button, Flex, HStack, Input, Text, VStack } from '@chakra-ui/react';
import { LuCheck, LuCirclePlus, LuPlug, LuTrash2, LuX } from 'react-icons/lu';
import SimpleSelect from '@/components/evals/SimpleSelect';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { toaster } from '@/components/ui/toaster';
import { isSecretRef } from '@/lib/secrets/config-secret-specs';
import {
  CUSTOM_PROVIDER, LLM_USE_CASES, MINUSX_PROVIDER, findMinusxProvider,
  type LlmConfig, type LlmModelChoice, type LlmProviderEntry, type LlmUseCase,
} from '@/lib/llm/llm-config-types';

interface RegistryProvider { slug: string; models: { id: string; name: string }[] }

/** Curated head of the provider picker; the rest of the registry follows alphabetically. */
const FEATURED_PROVIDERS = [MINUSX_PROVIDER, 'anthropic', 'openai', 'google', 'amazon-bedrock', CUSTOM_PROVIDER];

const PROVIDER_LABELS: Record<string, string> = {
  [MINUSX_PROVIDER]: 'MinusX (managed)',
  [CUSTOM_PROVIDER]: 'Custom (OpenAI-compatible)',
  'amazon-bedrock': 'Amazon Bedrock',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

const REASONING_OPTIONS = [
  { value: '', label: 'default' },
  { value: 'off', label: 'off' },
  { value: 'minimal', label: 'minimal' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

const USE_CASE_TITLES: Record<LlmUseCase, { title: string; description: string }> = {
  analyst: { title: 'Analyst', description: 'The main chat/analysis agent (Explore, Question, Dashboard, Slack, reports).' },
  micro: { title: 'Micro tasks', description: 'Low-stakes single-turn helpers (titles, descriptions, summaries).' },
};

function providerLabel(slug: string): string {
  return PROVIDER_LABELS[slug] ?? slug;
}

function keyStatus(entry: LlmProviderEntry): 'saved' | 'new' | 'none' {
  if (!entry.apiKey) return 'none';
  return isSecretRef(entry.apiKey) ? 'saved' : 'new';
}

export function LlmModelsSection({ variant = 'settings' }: { variant?: 'settings' | 'wizard' }) {
  const { config } = useConfigs();
  const [draft, setDraft] = useState<LlmConfig>(() => structuredClone(config.llm ?? {}));
  const [registry, setRegistry] = useState<RegistryProvider[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; detail: string }>>({});

  // Re-sync the draft when the stored config changes underneath (e.g. reload).
  const storedLlmJson = JSON.stringify(config.llm ?? {});
  useEffect(() => {
    setDraft(structuredClone(config.llm ?? {}));
  }, [storedLlmJson]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    fetch('/api/llm/registry', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(body => { if (!cancelled && body?.data?.providers) setRegistry(body.data.providers); })
      .catch(() => { /* picker degrades to free text */ });
    return () => { cancelled = true; };
  }, []);

  const dirty = JSON.stringify(draft) !== storedLlmJson;
  const providers = draft.providers ?? [];
  const minusx = findMinusxProvider(draft);
  const hasExplicitAssignments = Object.values(draft.assignments ?? {}).some(a => (a?.chain?.length ?? 0) > 0);

  const providerTypeOptions = useMemo(() => {
    const rest = registry.map(p => p.slug).filter(slug => !FEATURED_PROVIDERS.includes(slug)).sort();
    return [...FEATURED_PROVIDERS, ...rest].map(slug => ({ value: slug, label: providerLabel(slug) }));
  }, [registry]);

  const modelsFor = useCallback((slug: string) => registry.find(p => p.slug === slug)?.models ?? [], [registry]);

  const setProvider = (index: number, patch: Partial<LlmProviderEntry>) => {
    setDraft(d => {
      const next = structuredClone(d);
      next.providers = next.providers ?? [];
      next.providers[index] = { ...next.providers[index], ...patch };
      return next;
    });
  };

  const addProvider = () => {
    setDraft(d => ({
      ...structuredClone(d),
      providers: [...(d.providers ?? []), { name: '', provider: minusx ? 'anthropic' : MINUSX_PROVIDER }],
    }));
  };

  const removeProvider = (index: number) => {
    setDraft(d => {
      const next = structuredClone(d);
      const removed = next.providers?.[index]?.name;
      next.providers = (next.providers ?? []).filter((_, i) => i !== index);
      // Drop chain steps that referenced the removed provider.
      if (removed && next.assignments) {
        for (const useCase of LLM_USE_CASES) {
          const chain = next.assignments[useCase]?.chain?.filter(c => c.providerName !== removed);
          if (chain) {
            if (chain.length > 0) next.assignments[useCase] = { chain };
            else delete next.assignments[useCase];
          }
        }
      }
      return next;
    });
  };

  const setChain = (useCase: LlmUseCase, chain: LlmModelChoice[]) => {
    setDraft(d => {
      const next = structuredClone(d);
      next.assignments = next.assignments ?? {};
      if (chain.length > 0) next.assignments[useCase] = { chain };
      else delete next.assignments[useCase];
      return next;
    });
  };

  const save = async () => {
    for (const p of providers) {
      if (!p.name.trim()) {
        toaster.create({ title: 'Every provider needs a name', type: 'error' });
        return;
      }
    }
    const names = providers.map(p => p.name.trim());
    if (new Set(names).size !== names.length) {
      toaster.create({ title: 'Provider names must be unique', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await updateConfig({ llm: draft });
      toaster.create({ title: 'LLM configuration saved', type: 'success' });
    } catch (error) {
      toaster.create({ title: 'Failed to save LLM configuration', description: error instanceof Error ? error.message : undefined, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  /** Model used for a provider's connectivity test: its first chain use, else the registry's first model. */
  const testModelFor = (entry: LlmProviderEntry): string | undefined => {
    for (const useCase of LLM_USE_CASES) {
      const hit = draft.assignments?.[useCase]?.chain?.find(c => c.providerName === entry.name && c.model);
      if (hit?.model) return hit.model;
    }
    return modelsFor(entry.provider)[0]?.id;
  };

  const testProvider = async (entry: LlmProviderEntry) => {
    setTesting(entry.name);
    setTestResults(r => { const { [entry.name]: _out, ...rest } = r; return rest; });
    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: entry, model: testModelFor(entry) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'Test request failed');
      const ok = body.data?.ok === true;
      setTestResults(r => ({
        ...r,
        [entry.name]: ok
          ? { ok: true, detail: `Connected (${body.data.latencyMs}ms)` }
          : { ok: false, detail: body.data?.error ?? 'Connection failed' },
      }));
    } catch (error) {
      setTestResults(r => ({ ...r, [entry.name]: { ok: false, detail: error instanceof Error ? error.message : 'Test request failed' } }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <VStack align="stretch" gap={6} aria-label="LLM models settings">
      <Box>
        <Text fontSize="sm" fontWeight="semibold" fontFamily="mono" mb={1}>Providers</Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>
          Connect the LLM endpoints this workspace can use. Keys are stored server-side and never shown again.
        </Text>
        <VStack align="stretch" gap={3}>
          {providers.map((entry, index) => {
            const status = keyStatus(entry);
            const isMinusx = entry.provider === MINUSX_PROVIDER;
            const isCustom = entry.provider === CUSTOM_PROVIDER;
            const isBedrock = entry.provider === 'amazon-bedrock';
            const result = testResults[entry.name];
            const label = entry.name || `provider ${index + 1}`;
            return (
              <Box key={index} borderWidth="1px" borderColor="border.muted" borderRadius="md" p={4} aria-label={`LLM provider ${label}`}>
                <Flex gap={3} wrap="wrap" align="flex-end">
                  <Box minW="180px">
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Provider</Text>
                    <SimpleSelect
                      value={entry.provider}
                      onChange={(provider) => setProvider(index, { provider })}
                      options={providerTypeOptions}
                      placeholder="Search providers…"
                      ariaLabel={`LLM provider ${label} type`}
                    />
                  </Box>
                  <Box minW="160px">
                    <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Name</Text>
                    <Input
                      size="sm" fontSize="xs" fontFamily="mono"
                      value={entry.name}
                      placeholder={isMinusx ? 'minusx' : 'e.g. main-anthropic'}
                      onChange={(e) => setProvider(index, { name: e.target.value })}
                      autoComplete="off"
                      aria-label={`LLM provider ${label} name`}
                    />
                  </Box>
                  <Box minW="220px" flex="1">
                    <HStack mb={1} gap={2}>
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono">API key</Text>
                      {status === 'saved' && <Badge size="xs" colorPalette="teal" aria-label={`LLM provider ${label} key saved`}>saved</Badge>}
                    </HStack>
                    <Input
                      size="sm" fontSize="xs" fontFamily="mono"
                      type="password"
                      autoComplete="new-password"
                      value={status === 'saved' ? '' : (entry.apiKey ?? '')}
                      placeholder={status === 'saved' ? '•••••••• (saved — type to replace)' : isBedrock ? 'Bedrock API key (bearer token)' : 'API key'}
                      onChange={(e) => setProvider(index, { apiKey: e.target.value || (status === 'saved' ? entry.apiKey : undefined) })}
                      aria-label={`LLM provider ${label} API key`}
                    />
                  </Box>
                  {isBedrock && (
                    <Box minW="140px">
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>AWS region</Text>
                      <Input
                        size="sm" fontSize="xs" fontFamily="mono"
                        value={entry.awsRegion ?? ''}
                        placeholder="us-east-1"
                        onChange={(e) => setProvider(index, { awsRegion: e.target.value || undefined })}
                        aria-label={`LLM provider ${label} AWS region`}
                      />
                    </Box>
                  )}
                  {isCustom && (
                    <Box minW="240px">
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Base URL</Text>
                      <Input
                        size="sm" fontSize="xs" fontFamily="mono"
                        value={entry.baseUrl ?? ''}
                        placeholder="http://localhost:11434/v1"
                        onChange={(e) => setProvider(index, { baseUrl: e.target.value || undefined })}
                        aria-label={`LLM provider ${label} base URL`}
                      />
                    </Box>
                  )}
                  <HStack gap={2}>
                    <Button
                      size="sm" variant="outline" fontFamily="mono"
                      onClick={() => testProvider(entry)}
                      loading={testing === entry.name}
                      disabled={!entry.name || (status === 'none' && !isCustom)}
                      aria-label={`Test LLM provider ${label}`}
                    >
                      <LuPlug /> Test
                    </Button>
                    <Button
                      size="sm" variant="ghost" colorPalette="red"
                      onClick={() => removeProvider(index)}
                      aria-label={`Remove LLM provider ${label}`}
                    >
                      <LuTrash2 />
                    </Button>
                  </HStack>
                </Flex>
                {isMinusx && (
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono" mt={2}>
                    Fully managed: MinusX routes models, prompts and fallbacks per use case — no further setup needed.
                  </Text>
                )}
                {result && (
                  <HStack mt={2} gap={1} aria-label={`LLM provider ${label} test result`}>
                    {result.ok ? <LuCheck size={12} color="var(--chakra-colors-teal-500)" /> : <LuX size={12} color="var(--chakra-colors-red-500)" />}
                    <Text fontSize="xs" fontFamily="mono" color={result.ok ? 'teal.500' : 'red.500'}>{result.detail}</Text>
                  </HStack>
                )}
              </Box>
            );
          })}
          <Button size="sm" variant="outline" fontFamily="mono" alignSelf="flex-start" onClick={addProvider} aria-label="Add LLM provider">
            <LuCirclePlus /> Add provider
          </Button>
        </VStack>
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="semibold" fontFamily="mono" mb={1}>Model assignments</Text>
        {minusx && !hasExplicitAssignments ? (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" aria-label="Assignments managed by MinusX">
            Managed by MinusX — every use case routes through the MinusX gateway. Add an explicit assignment below to override.
          </Text>
        ) : (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Pick the model each use case runs on, with optional fallbacks tried in order when a model is unavailable.
          </Text>
        )}
        <VStack align="stretch" gap={4} mt={3}>
          {LLM_USE_CASES.map((useCase) => (
            <UseCaseChainEditor
              key={useCase}
              useCase={useCase}
              chain={draft.assignments?.[useCase]?.chain ?? []}
              providers={providers}
              modelsFor={modelsFor}
              onChange={(chain) => setChain(useCase, chain)}
            />
          ))}
        </VStack>
      </Box>

      <HStack>
        <Button
          size="sm" bg="accent.teal" color="white" fontFamily="mono"
          onClick={save}
          loading={saving}
          disabled={!dirty && variant === 'settings'}
          aria-label="Save LLM configuration"
        >
          Save LLM configuration
        </Button>
        {dirty && <Text fontSize="xs" color="fg.muted" fontFamily="mono">Unsaved changes</Text>}
      </HStack>
    </VStack>
  );
}

function UseCaseChainEditor({ useCase, chain, providers, modelsFor, onChange }: {
  useCase: LlmUseCase;
  chain: LlmModelChoice[];
  providers: LlmProviderEntry[];
  modelsFor: (slug: string) => { id: string; name: string }[];
  onChange: (chain: LlmModelChoice[]) => void;
}) {
  const meta = USE_CASE_TITLES[useCase];
  const providerOptions = providers.filter(p => p.name).map(p => ({ value: p.name, label: `${p.name} (${providerLabel(p.provider)})` }));

  const setStep = (index: number, patch: Partial<LlmModelChoice>) => {
    const next = chain.map((step, i) => (i === index ? { ...step, ...patch } : step));
    onChange(next);
  };

  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" p={4} aria-label={`Model assignment ${meta.title}`}>
      <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{meta.title}</Text>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>{meta.description}</Text>
      <VStack align="stretch" gap={2}>
        {chain.map((step, index) => {
          const entry = providers.find(p => p.name === step.providerName);
          const slug = entry?.provider ?? '';
          const registryModels = slug ? modelsFor(slug) : [];
          const stepLabel = `${meta.title} ${index === 0 ? 'primary' : `fallback ${index}`}`;
          const reasoning = (step.options?.['reasoning'] as string | undefined) ?? '';
          return (
            <Flex key={index} gap={3} wrap="wrap" align="center">
              <Badge size="xs" variant="surface" minW="72px" justifyContent="center">{index === 0 ? 'primary' : `fallback ${index}`}</Badge>
              <Box minW="200px">
                <SimpleSelect
                  value={step.providerName}
                  onChange={(providerName) => setStep(index, { providerName })}
                  options={providerOptions}
                  placeholder="Provider…"
                  ariaLabel={`${stepLabel} provider`}
                />
              </Box>
              {slug === MINUSX_PROVIDER ? (
                <Text fontSize="xs" color="fg.muted" fontFamily="mono">model routed by MinusX</Text>
              ) : registryModels.length > 0 ? (
                <Box minW="260px">
                  <SimpleSelect
                    value={step.model ?? ''}
                    onChange={(model) => setStep(index, { model })}
                    options={registryModels.map(m => ({ value: m.id, label: m.name === m.id ? m.id : `${m.name} (${m.id})` }))}
                    placeholder="Search models…"
                    ariaLabel={`${stepLabel} model`}
                  />
                </Box>
              ) : (
                <Input
                  size="sm" fontSize="xs" fontFamily="mono" maxW="260px"
                  value={step.model ?? ''}
                  placeholder="model id (e.g. qwen3:32b)"
                  onChange={(e) => setStep(index, { model: e.target.value || undefined })}
                  aria-label={`${stepLabel} model`}
                />
              )}
              {slug !== MINUSX_PROVIDER && (
                <Box minW="120px">
                  <SimpleSelect
                    value={reasoning}
                    onChange={(value) => setStep(index, { options: value ? { ...step.options, reasoning: value } : (() => { const { reasoning: _r, ...rest } = step.options ?? {}; return Object.keys(rest).length ? rest : undefined; })() })}
                    options={REASONING_OPTIONS}
                    placeholder="reasoning"
                    ariaLabel={`${stepLabel} reasoning`}
                  />
                </Box>
              )}
              <Button size="xs" variant="ghost" colorPalette="red" onClick={() => onChange(chain.filter((_, i) => i !== index))} aria-label={`Remove ${stepLabel}`}>
                <LuTrash2 />
              </Button>
            </Flex>
          );
        })}
        <Button
          size="xs" variant="outline" fontFamily="mono" alignSelf="flex-start"
          onClick={() => onChange([...chain, { providerName: providerOptions[0]?.value ?? '' }])}
          disabled={providerOptions.length === 0}
          aria-label={`Add ${meta.title} ${chain.length === 0 ? 'model' : 'fallback'}`}
        >
          <LuCirclePlus /> {chain.length === 0 ? 'Set model' : 'Add fallback'}
        </Button>
      </VStack>
    </Box>
  );
}
