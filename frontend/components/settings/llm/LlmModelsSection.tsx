'use client';

/**
 * LLM Models settings — in-app provider + model configuration (admin-only).
 *
 * Three-level editor over the org config's `llm` section:
 *   1. Providers — credentialed endpoints (MinusX managed / registry providers /
 *      custom OpenAI-compatible), each testable via POST /api/llm/test.
 *   2. Model grades — lite / core / advanced: one (provider, model, options) per
 *      grade, with searchable model pickers fed by GET /api/llm/registry.
 *   3. Agents — per-agent grade policy (allowed grades + default), sparse
 *      overrides on top of the built-in DEFAULT_AGENT_POLICIES.
 *
 * MinusX special-casing: the MinusX provider is pinned first in the picker and
 * needs only an API key — with no explicit grade mappings, the gateway routes
 * every grade itself, so the grades editor collapses to an informational
 * banner.
 *
 * Secrets: saved keys arrive as `@SECRETS/…` refs (never raw). A ref value
 * round-trips unchanged on save; typing a new key replaces it server-side.
 * Reused by the setup wizard (`variant="wizard"`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Box, Button, Flex, HStack, Input, Text, VStack } from '@chakra-ui/react';
import { LuCheck, LuCirclePlus, LuPlug, LuTrash2, LuX } from 'react-icons/lu';
import { SearchableSelect, SearchableMultiSelect } from '@/components/selectors/SearchableSelect';
import { useConfigs, updateConfig } from '@/lib/hooks/useConfigs';
import { useAppSelector } from '@/store/hooks';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { toaster } from '@/components/ui/toaster';
import { isSecretRef } from '@/lib/secrets/config-secret-specs';
import { COMPAT_PROVIDERS, compatDefaultModel } from '@/lib/llm/compat-models';
import {
  CUSTOM_PROVIDER, DEFAULT_AGENT_POLICIES, LLM_AGENT_KEYS, LLM_GRADES, MINUSX_PROVIDER,
  findMinusxProvider, resolveAgentPolicy,
  type LlmAgentKey, type LlmConfig, type LlmGrade, type LlmModelChoice, type LlmProviderEntry,
} from '@/lib/llm/llm-config-types';

interface RegistryProvider { slug: string; models: { id: string; name: string }[] }

/**
 * Curated head of the provider picker + display labels — derived from the
 * shared compatibility.json (frontend/compatibility.json) (the shared contract also driving setup.sh
 * and the docs tables), so the featured set is defined exactly once.
 * The rest of the registry follows alphabetically.
 */
const FEATURED_PROVIDERS = COMPAT_PROVIDERS.map(p => p.id);
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  COMPAT_PROVIDERS.map(p => [p.id, p.name]),
);

/** Picker options for a provider's registry models: the grade default badged + first, id as subtitle. */
function toModelOptions(slug: string, models: { id: string; name: string }[], grade: LlmGrade) {
  const gradeDefault = compatDefaultModel(slug, grade);
  return models
    .map(m => ({
      value: m.id,
      label: m.name === m.id ? m.id : m.name,
      subtitle: m.name === m.id ? undefined : m.id,
      badge: m.id === gradeDefault ? 'default' : undefined,
    }))
    .sort((a, b) => Number(!!b.badge) - Number(!!a.badge));
}

// Reasoning effort is currently fixed (no UI): every new grade mapping stores
// LOW explicitly. Hand-edited configs can still set other levels via
// `grades.<grade>.options.reasoning`; re-add a picker here if that's ever a
// common need.
const DEFAULT_REASONING = 'low';

const GRADE_TITLES: Record<LlmGrade, { title: string; description: string }> = {
  lite: { title: 'Lite', description: 'Fast + cheap (haiku-class) — titles, summaries, micro tasks.' },
  core: { title: 'Core', description: 'Balanced default (sonnet-class) — most analysis runs here.' },
  advanced: { title: 'Advanced', description: 'Strongest (opus-class) — the hardest analysis, slower and pricier.' },
};

const AGENT_TITLES: Record<LlmAgentKey, string> = {
  analyst: 'Analyst',
  'web-analyst': 'Web analyst',
  slack: 'Slack',
  report: 'Reports',
  micro: 'Micro tasks',
};

function providerLabel(slug: string): string {
  return PROVIDER_LABELS[slug] ?? slug;
}

function gradeLabel(grade: LlmGrade): string {
  return GRADE_TITLES[grade].title;
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
  const hasExplicitGrades = Object.keys(draft.grades ?? {}).length > 0;

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
      // grade mapping that referenced the old one — a dangling reference
      // would fail validation on save. Covers renames, clears, and type switches.
      if (prev && next.grades) {
        const oldEffective = prev.name || autoName(prev.provider, next.providers, index);
        const newEffective = updated.name || autoName(updated.provider, next.providers, index);
        if (oldEffective !== newEffective) {
          for (const grade of LLM_GRADES) {
            const choice = next.grades[grade];
            if (choice?.providerName === oldEffective) choice.providerName = newEffective;
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
      // Drop grade mappings that referenced the removed provider.
      if (removed && next.grades) {
        for (const grade of LLM_GRADES) {
          if (next.grades[grade]?.providerName === removed) delete next.grades[grade];
        }
      }
      return next;
    });
  };

  const setGrade = (grade: LlmGrade, choice: LlmModelChoice | undefined) => {
    setDraft(d => {
      const next = structuredClone(d);
      next.grades = next.grades ?? {};
      if (choice) next.grades[grade] = choice;
      else delete next.grades[grade];
      if (Object.keys(next.grades).length === 0) delete next.grades;
      return next;
    });
  };

  const setAgentPolicy = (agent: LlmAgentKey, patch: { allowedGrades?: LlmGrade[]; defaultGrade?: LlmGrade }) => {
    setDraft(d => {
      const next = structuredClone(d);
      const merged = { ...resolveAgentPolicy(next, agent), ...patch };
      const base = DEFAULT_AGENT_POLICIES[agent];
      const isBuiltIn = merged.defaultGrade === base.defaultGrade
        && merged.allowedGrades.length === base.allowedGrades.length
        && merged.allowedGrades.every(g => base.allowedGrades.includes(g));
      next.agents = next.agents ?? {};
      // Sparse storage: an override equal to the built-in is dropped, not stored.
      if (isBuiltIn) delete next.agents[agent];
      else next.agents[agent] = merged;
      if (Object.keys(next.agents).length === 0) delete next.agents;
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

  /** Model used for a provider's connectivity test: its first grade use, else the compat core default, else the registry's first. */
  const testModelFor = (entry: LlmProviderEntry): string | undefined => {
    for (const grade of LLM_GRADES) {
      const choice = draft.grades?.[grade];
      if (choice?.providerName === (entry.name || entry.provider) && choice.model) return choice.model;
    }
    return compatDefaultModel(entry.provider, 'core') ?? modelsFor(entry.provider)[0]?.id;
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
                    <SearchableSelect
                      value={entry.provider}
                      onChange={(provider) => setProvider(index, { provider })}
                      options={providerTypeOptions}
                      placeholder="Pick a provider…"
                      label={`LLM provider ${label} type`}
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
                    Fully managed: MinusX routes models, prompts and fallbacks per grade — no further setup needed.
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
        <Text fontSize="sm" fontWeight="semibold" fontFamily="mono" mb={1}>Model grades</Text>
        {minusx && !hasExplicitGrades ? (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" aria-label="Grades managed by MinusX">
            Managed by MinusX — every grade routes through the MinusX gateway. Map a grade below to override.
          </Text>
        ) : (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            Map each grade to the model it runs on. Agents and chat users pick grades, never raw models.
          </Text>
        )}
        <VStack align="stretch" gap={4} mt={3}>
          {LLM_GRADES.map((grade) => (
            <GradeSlotEditor
              key={grade}
              grade={grade}
              choice={draft.grades?.[grade]}
              providers={providers}
              modelsFor={modelsFor}
              onChange={(choice) => setGrade(grade, choice)}
            />
          ))}
        </VStack>
      </Box>

      <Box>
        <Text fontSize="sm" fontWeight="semibold" fontFamily="mono" mb={1}>Agents</Text>
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>
          Which grades each agent may use, and which it runs on by default.
        </Text>
        <VStack align="stretch" gap={3}>
          {LLM_AGENT_KEYS.map((agent) => (
            <AgentPolicyRow
              key={agent}
              agent={agent}
              policy={resolveAgentPolicy(draft, agent)}
              onChange={(patch) => setAgentPolicy(agent, patch)}
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

/** Small Auto toggle rendered beside a picker (lit teal while active). */
function AutoButton({ active, onClick, label, title }: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <Button
      size="sm" fontFamily="mono"
      variant={active ? 'solid' : 'outline'}
      bg={active ? 'accent.teal' : undefined}
      color={active ? 'white' : undefined}
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      Auto
    </Button>
  );
}

function GradeSlotEditor({ grade, choice, providers, modelsFor, onChange }: {
  grade: LlmGrade;
  choice: LlmModelChoice | undefined;
  providers: LlmProviderEntry[];
  modelsFor: (slug: string) => { id: string; name: string }[];
  onChange: (choice: LlmModelChoice | undefined) => void;
}) {
  const meta = GRADE_TITLES[grade];
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

  const setChoice = (patch: Partial<LlmModelChoice>) => {
    onChange({ ...(choice as LlmModelChoice), ...patch });
  };

  const entry = choice ? providers.find(p => (p.name || p.provider) === choice.providerName) : undefined;
  const slug = entry?.provider ?? '';
  const registryModels = slug ? modelsFor(slug) : [];

  // "Auto" (no stored model) resolves to the compatibility default for this grade.
  const autoDefault = slug ? compatDefaultModel(slug, grade) : undefined;

  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" p={4} aria-label={`Model grade ${meta.title}`}>
      <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{meta.title}</Text>
      <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={3}>{meta.description}</Text>
      <VStack align="stretch" gap={2}>
        {choice ? (
          <Flex gap={3} wrap="wrap" align="flex-end">
            <Box minW="200px">
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Provider</Text>
              <SearchableSelect
                value={choice.providerName}
                onChange={(providerName) => setChoice({ providerName })}
                options={providerOptions}
                placeholder="Provider…"
                label={`${meta.title} provider`}
              />
            </Box>
            {slug === MINUSX_PROVIDER ? (
              <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={2}>model routed by MinusX</Text>
            ) : (
              <Box minW="260px">
                <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Model</Text>
                <HStack gap={1.5}>
                  <Box flex="1" minW="180px">
                    {registryModels.length > 0 ? (
                      <SearchableSelect
                        value={choice.model ?? ''}
                        onChange={(model) => setChoice({ model })}
                        options={toModelOptions(slug, registryModels, grade)}
                        placeholder={autoDefault ? `Auto (${autoDefault})` : 'Pick a model…'}
                        label={`${meta.title} model`}
                      />
                    ) : (
                      <Input
                        size="sm" fontSize="xs" fontFamily="mono"
                        value={choice.model ?? ''}
                        placeholder="model id (e.g. qwen3:32b)"
                        onChange={(e) => setChoice({ model: e.target.value || undefined })}
                        aria-label={`${meta.title} model`}
                      />
                    )}
                  </Box>
                  {autoDefault && (
                    <AutoButton
                      active={!choice.model}
                      onClick={() => setChoice({ model: undefined })}
                      label={`${meta.title} model auto`}
                      title={`Automatically use ${autoDefault}`}
                    />
                  )}
                </HStack>
              </Box>
            )}
            <Button size="xs" variant="ghost" colorPalette="red" mb={1} onClick={() => onChange(undefined)} aria-label={`Remove ${meta.title} model`}>
              <LuTrash2 />
            </Button>
          </Flex>
        ) : (
          <Button
            size="xs" variant="outline" fontFamily="mono" alignSelf="flex-start"
            onClick={() => onChange({ providerName: providerOptions[0]?.value ?? '', options: { reasoning: DEFAULT_REASONING } })}
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

function AgentPolicyRow({ agent, policy, onChange }: {
  agent: LlmAgentKey;
  policy: { allowedGrades: LlmGrade[]; defaultGrade: LlmGrade };
  onChange: (patch: { allowedGrades?: LlmGrade[]; defaultGrade?: LlmGrade }) => void;
}) {
  const gradeOptions = LLM_GRADES.map(grade => ({ value: grade, label: gradeLabel(grade) }));
  // The default must stay pickable: bound the default picker to the allowed
  // set, badging the built-in default (micro → Lite, analyst → Core, …) the
  // same way the model pickers badge compatibility recommendations.
  const recommendedDefault = DEFAULT_AGENT_POLICIES[agent].defaultGrade;
  const defaultOptions = gradeOptions
    .filter(o => policy.allowedGrades.includes(o.value))
    .map(o => (o.value === recommendedDefault ? { ...o, badge: 'recommended' } : o));
  return (
    <Flex
      gap={3} wrap="wrap" align="flex-end"
      borderWidth="1px" borderColor="border.muted" borderRadius="md" p={3}
      aria-label={`Agent ${agent} grades`}
    >
      <Box minW="130px" flex="1">
        <Text fontSize="sm" fontWeight="medium" fontFamily="mono">{AGENT_TITLES[agent]}</Text>
      </Box>
      <Box minW="200px">
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Allowed grades</Text>
        <SearchableMultiSelect
          values={policy.allowedGrades}
          options={gradeOptions}
          placeholder="Pick grades…"
          summary={(v) => v.map(g => gradeLabel(g as LlmGrade)).join(', ')}
          label={`Agent ${agent} allowed grades`}
          onChange={(next) => {
            if (next.length === 0) return; // an agent always has at least one grade
            onChange({ allowedGrades: next as LlmGrade[] });
          }}
        />
      </Box>
      <Box minW="140px">
        <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={1}>Default grade</Text>
        <SearchableSelect
          value={policy.defaultGrade}
          onChange={(grade) => onChange({ defaultGrade: grade as LlmGrade })}
          options={defaultOptions}
          placeholder="Default…"
          label={`Agent ${agent} default grade`}
        />
      </Box>
    </Flex>
  );
}
