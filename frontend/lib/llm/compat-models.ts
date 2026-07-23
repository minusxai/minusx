/**
 * compatibility.json-backed model curation (client + server safe — static
 * JSON, no secrets, no env access). compatibility.json is the shared static
 * contract (also driving setup.sh and the docs tables); this module is the
 * single reader for its LLM model curation: one default model per provider
 * per grade — what an "Auto" grade mapping (a registry mapping stored with no
 * `model`) resolves to, badged as `default` in the admin model picker.
 */
import compatibility from '@/compatibility.json';
import { byokProviders, type LlmConfig, type LlmGrade, type LlmProviderEntry } from './llm-config-types';

export interface CompatProviderSpec {
  id: string;
  name: string;
  /** The grade's default model — the "Auto" pick. */
  defaults?: Partial<Record<LlmGrade, string>>;
}

export const COMPAT_PROVIDERS = compatibility.llm.providers as CompatProviderSpec[];

/** The model an Auto mapping resolves to for (provider, grade), if compatibility.json declares one. */
export function compatDefaultModel(provider: string, grade: LlmGrade): string | undefined {
  return COMPAT_PROVIDERS.find(p => p.id === provider)?.defaults?.[grade];
}

/**
 * The provider an UNMAPPED grade falls back to: the workspace's single
 * bring-your-own-key provider, when compatibility.json publishes a default
 * model for it at this grade. Connecting one provider therefore powers every
 * grade with no further setup — which is what the settings page implies, and
 * what the env-seed path has always guaranteed.
 *
 * Undefined when the pick would be a guess — 2+ BYOK providers (ambiguous), or
 * a provider with no curation for the grade (custom endpoints, niche registry
 * slugs). Those still error, pointing at Settings → Models.
 */
export function autoGradeProvider(config: LlmConfig | undefined, grade: LlmGrade): LlmProviderEntry | undefined {
  const byok = byokProviders(config);
  if (byok.length !== 1) return undefined;
  return compatDefaultModel(byok[0].provider, grade) ? byok[0] : undefined;
}
