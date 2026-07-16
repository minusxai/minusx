/**
 * compatibility.json-backed model curation (client + server safe — static
 * JSON, no secrets, no env access). compatibility.json is the shared static
 * contract (also driving setup.sh and the docs tables); this module is the
 * single reader for its LLM model curation:
 *
 *  - `recommended` per provider: the verified provider+model combinations,
 *    per use case (badged + sorted first in the settings pickers).
 *  - `defaults` per provider: the model an "Auto" assignment (a registry
 *    assignment stored with no `model`) resolves to per use case.
 *  - the interpretation of a provider entry's `allowedModels`:
 *    explicit list | 'auto' (= the recommended union) | absent (= everything).
 */
import compatibility from '@/compatibility.json';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { LLM_USE_CASES, type LlmProviderEntry, type LlmUseCase } from './llm-config-types';

export interface CompatProviderSpec {
  id: string;
  name: string;
  defaults?: Partial<Record<LlmUseCase, string>>;
  recommended?: Partial<Record<LlmUseCase, string[]>>;
}

export const COMPAT_PROVIDERS = compatibility.llm.providers as CompatProviderSpec[];

const EMPTY: ReadonlySet<string> = immutableSet<string>([]);

/**
 * Per-provider recommended sets; `union` serves use-case-agnostic contexts
 * (the provider-level allowed-models picker).
 */
const RECOMMENDED: Record<string, { byUseCase: Partial<Record<LlmUseCase, ReadonlySet<string>>>; union: ReadonlySet<string> }> = Object.fromEntries(
  COMPAT_PROVIDERS.map(p => {
    const byUseCase = Object.fromEntries(
      LLM_USE_CASES.map(uc => [uc, immutableSet(p.recommended?.[uc] ?? [])]),
    );
    const union = immutableSet(Object.values(byUseCase).flatMap(set => [...set]));
    return [p.id, { byUseCase, union }];
  }),
);

/** Recommended model ids for (provider, useCase); the union across use cases when no use case is given. */
export function recommendedModelIds(provider: string, useCase?: LlmUseCase): ReadonlySet<string> {
  const spec = RECOMMENDED[provider];
  if (!spec) return EMPTY;
  return (useCase ? spec.byUseCase[useCase] : spec.union) ?? EMPTY;
}

/** The model an Auto assignment resolves to for (provider, useCase), if compatibility.json declares one. */
export function compatDefaultModel(provider: string, useCase: LlmUseCase): string | undefined {
  return COMPAT_PROVIDERS.find(p => p.id === provider)?.defaults?.[useCase];
}

/**
 * The concrete model allowlist for a provider entry: undefined = unrestricted,
 * 'auto' = the provider's recommended union, else the stored list (empty =
 * unrestricted).
 */
export function resolveAllowedModels(entry: LlmProviderEntry | undefined): string[] | undefined {
  const allowed = entry?.allowedModels;
  if (!allowed) return undefined;
  if (allowed === 'auto') return [...recommendedModelIds(entry!.provider)];
  return allowed.length > 0 ? allowed : undefined;
}

/**
 * Apply a provider's allowlist to a registry model list. No allowlist passes
 * everything through; `keep` (the currently-assigned model id) always
 * survives the filter so an existing pick never disappears.
 */
export function filterAllowedModels<T extends { id: string }>(
  entry: LlmProviderEntry | undefined,
  models: T[],
  keep?: string,
): T[] {
  const allowed = resolveAllowedModels(entry);
  if (!allowed) return models;
  const set = new Set(allowed);
  return models.filter(m => set.has(m.id) || (keep !== undefined && m.id === keep));
}
