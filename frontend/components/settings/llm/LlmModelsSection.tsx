'use client';

/**
 * LLM Models settings — in-app provider + model configuration (admin-only).
 *
 * Two-level editor over the org config's `llm` section:
 *   1. Providers — credentialed endpoints (MinusX managed / registry providers /
 *      custom OpenAI-compatible), each testable via POST /api/llm/test.
 *   2. Assignments — per use case (analyst / micro): one model each, with
 *      searchable model pickers fed by GET /api/llm/registry.
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
import { Badge, Box, Button, Dialog, Flex, HStack, Input, Text, VStack } from '@chakra-ui/react';
import { LuCheck, LuCirclePlus, LuPlug, LuSettings2, LuTrash2, LuX } from 'react-icons/lu';
import SimpleSelect from '@/components/evals/SimpleSelect';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { useAppSelector } from '@/store/hooks';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
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

// No ambiguous 'default' entry — the default level is LOW and shows as the
// pre-selected option, so what's selected is always what runs.
const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high'] as const;
const DEFAULT_REASONING = 'low';

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
  const userMode = useAppSelector((state) => state.auth.user?.mode);
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

  // The name is an internal identity (auto = the provider type). The field
  // only surfaces when it's actually needed: duplicate provider types, or an
  // existing custom name (clearing it hides the field again).
  const slugCounts = providers.reduce<Record<string, number>>((acc, p) => {
    acc[p.provider] = (acc[p.provider] ?? 0) + 1;
    return acc;
  }, {});
  const showNameField = (entry: LlmProviderEntry) =>
    (slugCounts[entry.provider] ?? 0) > 1 || (entry.name !== '' && entry.name !== entry.provider);

  const providerTypeOptions = useMemo(() => {
    const rest = registry.map(p => p.slug).filter(slug => !FEATURED_PROVIDERS.includes(slug)).sort();
    return [...FEATURED_PROVIDERS, ...rest].map(slug => ({ value: slug, label: providerLabel(slug) }));
  }, [registry]);

  const modelsFor = useCallback((slug: string) => registry.find(p => p.slug === slug)?.models ?? [], [registry]);

  /** Default (auto) name for a provider slug, unique among the other entries. */
  const autoName = (slug: string, existing: LlmProviderEntry[], selfIndex: number): string => {
    const taken = new Set(existing.filter((_, i) => i !== selfIndex).map(p => p.name));
    if (!taken.has(slug)) return slug;
    let n = 2;
    while (taken.has(`${slug}-${n}`)) n++;
    return `${slug}-${n}`;
  };

  const setProvider = (index: number, patch: Partial<LlmProviderEntry>) => {
    setDraft(d => {
      const next = structuredClone(d);
      next.providers = next.providers ?? [];
      const prev = next.providers[index];
      // Switching the provider type refreshes an auto-generated name; a
      // user-customized name is left alone.
      if (patch.provider !== undefined && prev && (prev.name === '' || prev.name === prev.provider || prev.name === autoName(prev.provider, next.providers, index))) {
        patch = { ...patch, name: autoName(patch.provider, next.providers, index) };
      }
      const updated = { ...prev, ...patch };
      next.providers[index] = updated;
      // Cascade the EFFECTIVE name (blank name = the auto name) into every
      // assignment chain that referenced the old one — a dangling reference
      // would fail validation on save. Covers renames, clears, and type switches.
      if (prev && next.assignments) {
        const oldEffective = prev.name || autoName(prev.provider, next.providers, index);
        const newEffective = updated.name || autoName(updated.provider, next.providers, index);
        if (oldEffective !== newEffective) {
          for (const useCase of LLM_USE_CASES) {
            for (const step of next.assignments[useCase]?.chain ?? []) {
              if (step.providerName === oldEffective) step.providerName = newEffective;
            }
          }
        }
      }
      return next;
    });
  };

  const addProvider = () => {
    setDraft(d => {
      const next = structuredClone(d);
      next.providers = next.providers ?? [];
      const slug = minusx ? 'anthropic' : MINUSX_PROVIDER;
      next.providers.push({ name: autoName(slug, next.providers, -1), provider: slug });
      return next;
    });
  };

  const removeProvider = (index: number) => {
    setDraft(d => {
      const next = structuredClone(d);
      const entry = next.providers?.[index];
      const removed = entry ? (entry.name || entry.provider) : undefined;
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
    // A blanked-out name falls back to the auto name (name is optional).
    const toSave = structuredClone(draft);
    toSave.providers?.forEach((p, i) => {
      if (!p.name.trim()) p.name = autoName(p.provider, toSave.providers!, i);
    });
    const names = (toSave.providers ?? []).map(p => p.name.trim());
    if (new Set(names).size !== names.length) {
      toaster.create({ title: 'Provider names must be unique', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await updateConfig({ llm: toSave });
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
      const hit = draft.assignments?.[useCase]?.chain?.find(c => c.providerName === (entry.name || entry.provider) && c.model);
      if (hit?.model) return hit.model;
    }
    return modelsFor(entry.provider)[0]?.id;
  };

  const testProvider = async (entry: LlmProviderEntry) => {
    const key = entry.name || entry.provider;
    setTesting(key);
    setTestResults(r => { const { [key]: _out, ...rest } = r; return rest; });
    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Effective name: a blank name resolves to the provider type.
        body: JSON.stringify({ provider: { ...entry, name: entry.name || entry.provider }, model: testModelFor(entry) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'Test request failed');
      const ok = body.data?.ok === true;
      setTestResults(r => ({
        ...r,
        [key]: ok
          ? { ok: true, detail: `Connected (${body.data.latencyMs}ms)` }
          : { ok: false, detail: body.data?.error ?? 'Connection failed' },
      }));
    } catch (error) {
      setTestResults(r => ({ ...r, [key]: { ok: false, detail: error instanceof Error ? error.message : 'Test request failed' } }));
    } finally {
      setTesting(null);
    }
  };

  // LLM config is workspace-level: resolution always reads the ORG config
  // regardless of the caller's mode (lib/llm/llm-plan.server.ts). Outside org
  // mode, editing here would write a per-mode config doc that resolution
  // ignores — show a pointer to the workspace settings instead.
  if (userMode && userMode !== DEFAULT_MODE) {
    return (
      <VStack align="stretch" gap={3} aria-label="Models workspace-level notice">
        <Text fontSize="sm" fontFamily="mono">
          AI models are configured once for the whole workspace — every mode (including this one) uses the same providers.
        </Text>
        <Button
          size="sm"
          variant="outline"
          alignSelf="flex-start"
          fontFamily="mono"
          aria-label="Open workspace settings"
          // Direct navigation (not switchMode, which always lands on home):
          // org is the default mode, so a bare settings URL targets it.
          onClick={() => { window.location.href = '/settings?tab=models'; }}
        >
          Open workspace settings
        </Button>
      </VStack>
    );
  }

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
            const result = testResults[entry.name || entry.provider];
            const label = entry.name || entry.provider || `provider ${index + 1}`;
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
                  {showNameField(entry) && (
                    <Box minW="160px">
                      <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Name</Text>
                      <Input
                        size="sm" fontSize="xs" fontFamily="mono"
                        value={entry.name === entry.provider ? '' : entry.name}
                        placeholder={entry.provider}
                        onChange={(e) => setProvider(index, { name: e.target.value })}
                        autoComplete="off"
                        aria-label={`LLM provider ${label} name`}
                      />
                    </Box>
                  )}
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
                      loading={testing === (entry.name || entry.provider)}
                      disabled={status === 'none' && !isCustom}
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
            Pick the model each use case runs on.
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
  // Options key on the EFFECTIVE name (blank = the provider type). The custom
  // name only appears in the label when it exists or the type is ambiguous.
  const typeCounts = providers.reduce<Record<string, number>>((acc, p) => {
    acc[p.provider] = (acc[p.provider] ?? 0) + 1;
    return acc;
  }, {});
  const providerOptions = providers.map(p => {
    const effective = p.name || p.provider;
    const needsName = (typeCounts[p.provider] ?? 0) > 1 || (p.name !== '' && p.name !== p.provider);
    return { value: effective, label: needsName ? `${effective} (${providerLabel(p.provider)})` : providerLabel(p.provider) };
  });

  // One model per use case: the stored `chain` array is a stable shape whose
  // FIRST entry is the assignment (extra legacy entries are ignored).
  const step = chain[0];
  const setStep = (patch: Partial<LlmModelChoice>) => {
    onChange([{ ...step, ...patch }]);
  };

  const [optionsOpen, setOptionsOpen] = useState(false);

  const entry = step ? providers.find(p => (p.name || p.provider) === step.providerName) : undefined;
  const slug = entry?.provider ?? '';
  const registryModels = slug ? modelsFor(slug) : [];
  const reasoning = (step?.options?.['reasoning'] as string | undefined) ?? DEFAULT_REASONING;

  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" p={4} aria-label={`Model assignment ${meta.title}`}>
      <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{meta.title}</Text>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>{meta.description}</Text>
      <VStack align="stretch" gap={2}>
        {step ? (
          <Flex gap={3} wrap="wrap" align="flex-end">
            <Box minW="200px">
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Provider</Text>
              <SimpleSelect
                value={step.providerName}
                onChange={(providerName) => setStep({ providerName })}
                options={providerOptions}
                placeholder="Provider…"
                ariaLabel={`${meta.title} provider`}
              />
            </Box>
            {slug === MINUSX_PROVIDER ? (
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={2}>model routed by MinusX</Text>
            ) : (
              <Box minW="260px">
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Model</Text>
                {registryModels.length > 0 ? (
                  <SimpleSelect
                    value={step.model ?? ''}
                    onChange={(model) => setStep({ model })}
                    options={registryModels.map(m => ({ value: m.id, label: m.name === m.id ? m.id : `${m.name} (${m.id})` }))}
                    placeholder="Search models…"
                    ariaLabel={`${meta.title} model`}
                  />
                ) : (
                  <Input
                    size="sm" fontSize="xs" fontFamily="mono"
                    value={step.model ?? ''}
                    placeholder="model id (e.g. qwen3:32b)"
                    onChange={(e) => setStep({ model: e.target.value || undefined })}
                    aria-label={`${meta.title} model`}
                  />
                )}
              </Box>
            )}
            {slug !== MINUSX_PROVIDER && (
              <Button size="xs" variant="ghost" mb={1} onClick={() => setOptionsOpen(true)} aria-label={`${meta.title} options`} title="Model options">
                <LuSettings2 />
              </Button>
            )}
            <Button size="xs" variant="ghost" colorPalette="red" mb={1} onClick={() => onChange([])} aria-label={`Remove ${meta.title} model`}>
              <LuTrash2 />
            </Button>
            {optionsOpen && (
              <StepOptionsModal
                stepLabel={meta.title}
                reasoning={reasoning}
                onReasoningChange={(value) => setStep({ options: { ...step.options, reasoning: value } })}
                onClose={() => setOptionsOpen(false)}
              />
            )}
          </Flex>
        ) : (
          <Button
            size="xs" variant="outline" fontFamily="mono" alignSelf="flex-start"
            onClick={() => onChange([{ providerName: providerOptions[0]?.value ?? '', options: { reasoning: DEFAULT_REASONING } }])}
            disabled={providerOptions.length === 0}
            aria-label={`Add ${meta.title} model`}
          >
            <LuCirclePlus /> Set model
          </Button>
        )}
      </VStack>
    </Box>
  );
}

/**
 * Per-step model options. Only reasoning effort for now; future per-model
 * options (temperature, max tokens, …) get rows here instead of new columns
 * in the chain row.
 */
function StepOptionsModal({ stepLabel, reasoning, onReasoningChange, onClose }: {
  stepLabel: string;
  reasoning: string;
  onReasoningChange: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(d) => { if (!d.open) onClose(); }}>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content maxW="420px" aria-label={`Model options for ${stepLabel}`}>
          <Dialog.Header>
            <Dialog.Title fontSize="md" fontFamily="mono">Model options — {stepLabel}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text fontSize="xs" fontWeight="medium" fontFamily="mono" mb={1}>Reasoning effort</Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={2}>
              How much the model thinks before answering. Higher = better on hard questions, slower and pricier.
            </Text>
            <HStack gap={1} wrap="wrap">
              {REASONING_LEVELS.map(level => {
                const selected = reasoning === level;
                return (
                  <Button
                    key={level}
                    size="xs" fontFamily="mono"
                    variant={selected ? 'solid' : 'outline'}
                    bg={selected ? 'accent.teal' : undefined}
                    color={selected ? 'white' : undefined}
                    onClick={() => onReasoningChange(level)}
                    aria-label={selected ? `Reasoning effort ${level} selected` : `Set reasoning effort ${level}`}
                  >
                    {level}
                  </Button>
                );
              })}
            </HStack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button size="sm" fontFamily="mono" onClick={onClose} aria-label="Close model options">
              Done
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
